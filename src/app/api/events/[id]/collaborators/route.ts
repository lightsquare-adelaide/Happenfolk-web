import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { logApiEvent, LogReason } from "@/lib/log";
import { isUuid, jsonObjectProblem, unsupportedFieldProblem } from "@/lib/events";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Roster management is HOST-only (is_event_host). The membership rule
 * for ordinary EDITING stays in requireCollaborator — see
 * PATCH /api/events/[id]. The last-host rule is the
 * 20261026000700 trigger; this route surfaces its condition as a 409
 * with a friendly message instead of pre-judging it (single authority)
 * and never echoes the database text.
 */
async function requireHost(supabase: SupabaseClient, uid: string, eventId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_event_host", { p_event: eventId, p_member: uid });
  return data === true;
}

const NOT_HOST = "Event not found or only its organiser manages the roster";

/** POST /api/events/[id]/collaborators — JSON { handle }: host adds one. */
export async function POST(request: Request, context: RouteContext) {
  const route = "/api/events/[id]/collaborators";
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_roster_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireHost(supabase, user.id, id))) {
    logApiEvent({ event: "events_roster_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: NOT_HOST }, { status: 404 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const objectProblem = jsonObjectProblem(parsed);
  if (objectProblem) return NextResponse.json({ error: objectProblem }, { status: 400 });
  const body = parsed as Record<string, unknown>;
  const unsupported = unsupportedFieldProblem(body, ["handle"]);
  if (unsupported) return NextResponse.json({ error: unsupported }, { status: 400 });

  if (typeof body.handle !== "string" || body.handle.trim().length === 0 || body.handle.trim().length > 30) {
    return NextResponse.json({ error: "Missing handle" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, handle, display_name")
    .eq("handle", body.handle.trim())
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "No artist with this handle" }, { status: 404 });

  const { error } = await supabase
    .from("event_collaborators")
    .insert({ event_id: id, profile_id: profile.id, role: "collaborator" });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That person is already a collaborator" }, { status: 409 });
    }
    logApiEvent({ event: "events_roster_failed", route, status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Could not add the collaborator" }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, collaborator: { id: profile.id, handle: profile.handle, display_name: profile.display_name } },
    { status: 201 },
  );
}

/** DELETE /api/events/[id]/collaborators — JSON { profileId }: host removes one. */
export async function DELETE(request: Request, context: RouteContext) {
  const route = "/api/events/[id]/collaborators";
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_roster_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireHost(supabase, user.id, id))) {
    logApiEvent({ event: "events_roster_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: NOT_HOST }, { status: 404 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const objectProblem = jsonObjectProblem(parsed);
  if (objectProblem) return NextResponse.json({ error: objectProblem }, { status: 400 });
  const body = parsed as Record<string, unknown>;
  const unsupported = unsupportedFieldProblem(body, ["profileId"]);
  if (unsupported) return NextResponse.json({ error: unsupported }, { status: 400 });

  if (!isUuid(body.profileId)) {
    return NextResponse.json({ error: "Invalid artist identifier" }, { status: 400 });
  }

  // The trigger is the authority on the last-host rule; its LAST_HOST
  // condition becomes a friendly 409 here. Zero deleted rows means the
  // artist is not on this roster (or RLS refused) — reported as 404.
  const { data: removed, error } = await supabase
    .from("event_collaborators")
    .delete()
    .eq("event_id", id)
    .eq("profile_id", body.profileId)
    .select("profile_id");
  if (error) {
    const lastHost = error.message.includes("LAST_HOST");
    logApiEvent({
      event: lastHost ? "events_roster_last_host" : "events_roster_failed",
      route,
      status: lastHost ? 409 : 500,
      reason: lastHost ? LogReason.ownershipDenied : LogReason.upstreamError,
      userId: user.id,
    });
    return NextResponse.json(
      { error: lastHost
        ? "At least one organiser must remain — the last host cannot be removed"
        : "Could not remove the collaborator" },
      { status: lastHost ? 409 : 500 },
    );
  }
  if (!removed || removed.length === 0) {
    return NextResponse.json({ error: "That artist is not on this roster" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
