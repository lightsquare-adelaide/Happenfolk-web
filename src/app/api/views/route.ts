import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { logApiEvent, LogReason } from "@/lib/log";
import {
  anonViewAllowed,
  forwardedTrustMode,
  isViewSubjectId,
  isViewSubjectType,
  isValidForwardedUserAgent,
  readBoundedBody,
  trustedClientIp,
  viewThrottleKey,
  type ViewSubjectType,
} from "@/lib/view-throttle";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * POST /api/views — records one page view for a detail page.
 * Body: exactly { subjectType: "event"|"profile"|"portfolio_item",
 * subjectId: <uuid> }. Extra keys, wrong types, malformed JSON and
 * over-size bodies are rejected with 400 before anything is touched.
 *
 * Identity rules (S2):
 * - PUBLIC-SUBJECT PRECHECK: before either RPC, the subject must be
 *   publicly visible — profile.published, event status published, or
 *   portfolio_item.published AND the OWNING profile published. F's
 *   record_page_view checks only the item's own flag (frozen, unchanged),
 *   so without this precheck a published work of a private artist would
 *   be recordable through the owner's private preview. The check runs
 *   through the CALLER's own RLS-scoped client with explicit predicates
 *   (never service role), and every invisible subject produces the same
 *   quiet { ok: false } as an unknown id — no existence leaks.
 * - Signed-in members are recorded via record_member_view, which pins
 *   the identity to auth.uid() verified by getUser(). There is no
 *   parameter anywhere to record a view "as" somebody else.
 * - Anonymous recording needs BOTH a trusted client IP and the original
 *   User-Agent, forwarded to PostgREST on a deliberately scoped client
 *   so F's per-identity dedupe (migration 20261026000600) sees each real
 *   visitor instead of this server's single SDK fingerprint. The IP is
 *   read only from the platform/proxy header of an explicitly trusted
 *   mode (VERCEL=1, or the documented self-hosted opt-in
 *   VIEW_RECORDING_TRUST_FORWARDED_FOR=1).
 * - Missing-identity policy: without a trusted IP or a usable original
 *   UA the anonymous view is SKIPPED (200, skipped) — page reads are
 *   never affected, and no global fingerprint is invented that would
 *   let one visitor suppress everybody else.
 *
 * Privacy: the raw IP and User-Agent are used only for the RPC identity
 * derivation and the hashed in-memory throttle key; they are never
 * logged, stored here, or returned. Log lines carry only the fixed
 * allow-listed fields of src/lib/log.ts.
 *
 * Failures are quiet by design: a view counter must never break the
 * page the visitor is reading, so recording problems return 200 with
 * ok:false (or skipped/throttled) instead of 5xx noise.
 */

type ViewBody = { subjectType: ViewSubjectType; subjectId: string };

function badRequest(event: string, route: string) {
  logApiEvent({ event, route, status: 400, reason: LogReason.invalidRequest, userId: null });
  return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
}

/** Strict shape check: plain object, exactly the two allowed keys. */
function parseViewBody(raw: string): ViewBody | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes("subjectType") || !keys.includes("subjectId")) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  if (!isViewSubjectType(body.subjectType) || !isViewSubjectId(body.subjectId)) return null;
  return { subjectType: body.subjectType, subjectId: body.subjectId };
}

/**
 * Public-visibility precheck (lead review 2026-10-27). Explicit
 * predicates on the caller-scoped client: for an owner whose profile is
 * private, RLS alone would happily return their own rows, so the
 * published/status filters — not RLS — define "public subject" here.
 * Unknown ids, drafts, cancelled events, private profiles and private
 * owners' published items all collapse to the same false, and the route
 * answers them identically (no existence leaks).
 */
async function isPubliclyVisibleSubject(
  supabase: SupabaseClient,
  subjectType: ViewSubjectType,
  subjectId: string,
): Promise<boolean> {
  if (subjectType === "profile") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", subjectId)
      .eq("published", true)
      .maybeSingle();
    return !error && data !== null;
  }
  if (subjectType === "event") {
    const { data, error } = await supabase
      .from("events")
      .select("id")
      .eq("id", subjectId)
      .eq("status", "published")
      .maybeSingle();
    return !error && data !== null;
  }
  // portfolio_item: BOTH the item's flag and the owning profile's
  // published flag (inner join so a private owner drops the row).
  const { data, error } = await supabase
    .from("portfolio_items")
    .select("id, profiles!inner(published)")
    .eq("id", subjectId)
    .eq("published", true)
    .eq("profiles.published", true)
    .maybeSingle();
  return !error && data !== null;
}

export async function POST(request: Request) {
  const route = "/api/views";

  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "views_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ ok: false, error: "Cross-origin requests are not allowed" }, { status: 403 });
  }

  // Bounded STREAM read: an oversized body is cancelled mid-flight, not
  // fully buffered before rejection.
  const raw = await readBoundedBody(request);
  if (raw === null) {
    return badRequest("views_invalid_body_size", route);
  }
  const body = parseViewBody(raw);
  if (!body) return badRequest("views_invalid_body", route);

  const supabase = await createSupabaseServerClient();

  // Visibility precheck BEFORE any RPC, for members and anonymous alike.
  const isPublic = await isPubliclyVisibleSubject(supabase, body.subjectType, body.subjectId);
  if (!isPublic) {
    logApiEvent({ event: "views_subject_not_public", route, status: 200, reason: LogReason.invalidContent, userId: null });
    return NextResponse.json({ ok: false });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Member path: identity is the verified auth.uid() inside the RPC.
    const { error } = await supabase.rpc("record_member_view", {
      p_subject_type: body.subjectType,
      p_subject_id: body.subjectId,
    });
    if (error) {
      // SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED (draft/private/cancelled or
      // unknown id) — the DB is the visibility authority; log the reason
      // code only, never the message details of the caller.
      logApiEvent({ event: "views_member_rejected", route, status: 200, reason: LogReason.invalidContent, userId: user.id });
      return NextResponse.json({ ok: false });
    }
    return NextResponse.json({ ok: true });
  }

  // Anonymous path: trusted-proxy identity or skip.
  const mode = forwardedTrustMode(process.env);
  const clientIp = trustedClientIp(request.headers, mode);
  const userAgent = request.headers.get("user-agent")?.trim() ?? "";
  if (!clientIp || !isValidForwardedUserAgent(userAgent)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const key = viewThrottleKey(body.subjectType, body.subjectId, clientIp, userAgent);
  if (!anonViewAllowed(key)) {
    return NextResponse.json({ ok: true, throttled: true });
  }

  // Scoped recording client: forwards ONLY the validated trusted IP and
  // original UA to PostgREST (see createSupabaseServerClient docs).
  const recorder = await createSupabaseServerClient({
    viewRecordingIdentity: { clientIp, userAgent },
  });
  const { error } = await recorder.rpc("record_page_view", {
    p_subject_type: body.subjectType,
    p_subject_id: body.subjectId,
  });
  if (error) {
    logApiEvent({ event: "views_anon_rejected", route, status: 200, reason: LogReason.invalidContent, userId: null });
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}
