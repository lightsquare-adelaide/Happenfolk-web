import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { LogReason, logApiEvent } from "@/lib/log";
import { currentUserId, setAssetAlt } from "@/lib/media/store";
import { ALT_TEXT_MAX, isJsonObject, isUuid } from "@/lib/portfolio-management";

const ROUTE = "/api/portfolio/media";
const NOT_FOUND = "Work not found or not yours";

/**
 * PATCH /api/portfolio/media — JSON { itemId, assetId, alt }.
 * Per-asset caption editing for DRAFT originals only, serialized on
 * the existing #20 media-operation lease (store.setAssetAlt). One
 * owned original of one owned item; bounded nonblank alt; the work
 * must be unpublished so public derivative captions never go stale.
 * Distinct captions stay distinct — this route never bulk-rewrites,
 * and manager publication omits the global altText override.
 */
export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "portfolio_alt_denied", route: ROUTE, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) {
    logApiEvent({ event: "portfolio_alt_denied", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  if (!isJsonObject(raw)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const known = new Set(["itemId", "assetId", "alt"]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      return NextResponse.json({ error: `Unsupported field: ${key}` }, { status: 400 });
    }
  }
  const { itemId, assetId, alt } = raw as { itemId?: unknown; assetId?: unknown; alt?: unknown };
  if (!isUuid(itemId) || !isUuid(assetId)) {
    return NextResponse.json({ error: "Invalid work or media identifier" }, { status: 400 });
  }
  if (typeof alt !== "string") {
    return NextResponse.json({ error: "Alt text must be text" }, { status: 400 });
  }
  if (alt.trim().length === 0) {
    return NextResponse.json({ error: "Alt text cannot be empty: describe what this media shows" }, { status: 400 });
  }
  if (alt.trim().length > ALT_TEXT_MAX) {
    return NextResponse.json({ error: `Alt text must be at most ${ALT_TEXT_MAX} characters` }, { status: 400 });
  }

  const outcome = await setAssetAlt(supabase, uid, itemId, assetId, alt);
  if (!outcome.ok) {
    logApiEvent({
      event: "portfolio_alt_failed",
      route: ROUTE,
      status: outcome.status,
      reason: outcome.status === 404 ? LogReason.ownershipDenied : outcome.status >= 500 ? LogReason.upstreamError : LogReason.invalidRequest,
      userId: uid,
    });
    return NextResponse.json(
      {
        error: outcome.status === 404 && outcome.problem.startsWith("Work item") ? NOT_FOUND : outcome.problem,
        hint: outcome.hint,
      },
      { status: outcome.status },
    );
  }
  return NextResponse.json(outcome);
}

export const runtime = "nodejs";
