import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { LogReason, logApiEvent } from "@/lib/log";
import { currentUserId } from "@/lib/media/store";
import { parseMoveRequest } from "@/lib/portfolio-management";

const ROUTE = "/api/portfolio/reorder";

/**
 * POST /api/portfolio/reorder — JSON { itemId, direction: 'up'|'down' }.
 * A thin, friendly face over the accepted database transaction
 * public.move_portfolio_item(p_item_id, p_direction): caller-profile
 * lock, whole-list dense normalization, neighbor swap. There is no
 * two-UPDATE partial swap and no caller-supplied owner anywhere; the
 * personal-portfolio source's "self-healing" claim is NOT ported.
 * Returns { ok: true, moved: boolean } — moved=false is the edge no-op.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "portfolio_reorder_denied", route: ROUTE, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) {
    logApiEvent({ event: "portfolio_reorder_denied", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = parseMoveRequest(raw);
  if (!parsed.ok) {
    logApiEvent({ event: "portfolio_reorder_denied", route: ROUTE, status: 400, reason: LogReason.invalidRequest, userId: uid });
    return NextResponse.json({ error: parsed.problem }, { status: 400 });
  }
  const { itemId, direction } = parsed.value;

  const { data, error } = await supabase.rpc("move_portfolio_item", {
    p_item_id: itemId,
    p_direction: direction,
  });
  if (error) {
    // 42501 covers unsigned-in, missing and foreign items alike: one
    // friendly answer, no existence leak, no raw database text.
    const foreign = error.code === "42501" || error.code === "P0002";
    const status = foreign ? 404 : 500;
    logApiEvent({
      event: "portfolio_reorder_denied",
      route: ROUTE,
      status,
      reason: foreign ? LogReason.ownershipDenied : LogReason.upstreamError,
      userId: uid,
    });
    return NextResponse.json(
      { error: foreign ? "Work not found or not yours" : "Could not reorder the work; please retry" },
      { status },
    );
  }
  return NextResponse.json({ ok: true, moved: data === true });
}

export const runtime = "nodejs";
