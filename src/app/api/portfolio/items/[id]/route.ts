import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { LogReason, logApiEvent } from "@/lib/log";
import { currentUserId, deleteItem } from "@/lib/media/store";
import { isUuid, parseItemPatch } from "@/lib/portfolio-management";

const ROUTE = "/api/portfolio/items/[id]";
const NOT_FOUND = "Work not found or not yours";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * THE OWNERSHIP GATE — loads the item only when it belongs to the
 * caller, BEFORE any write is attempted, so a stranger learns neither
 * the data nor the existence of the work. The RLS policies and the
 * column grants (20261013000100 + 20261026000800) remain the database
 * layer underneath; tests/portfolio asserts both layers by data state.
 */
async function loadOwnedItem(supabase: SupabaseClient, uid: string, itemId: string) {
  const { data: item } = await supabase
    .from("portfolio_items")
    .select("id, profile_id, published")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.profile_id !== uid) return null;
  return item;
}

async function deniedOrigin(request: Request) {
  if (isSameOriginRequest(request)) return null;
  logApiEvent({ event: "portfolio_item_denied", route: ROUTE, status: 403, reason: LogReason.ownershipDenied, userId: null });
  return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
}

/**
 * PATCH /api/portfolio/items/[id] — JSON { title?, description?, year?, tags? }.
 * Metadata ONLY: profile_id, position, published, media_kind and raw
 * row pass-through are rejected by the strict allowlist. Publication
 * stays with the #20 validated media pipeline; ordering stays with the
 * move RPC.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const crossOrigin = await deniedOrigin(request);
  if (crossOrigin) return crossOrigin;
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) {
    logApiEvent({ event: "portfolio_item_denied", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work identifier" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = parseItemPatch(raw);
  if (!parsed.ok) {
    logApiEvent({ event: "portfolio_item_denied", route: ROUTE, status: 400, reason: LogReason.invalidRequest, userId: uid });
    return NextResponse.json({ error: parsed.problem }, { status: 400 });
  }

  const item = await loadOwnedItem(supabase, uid, id);
  if (!item) {
    logApiEvent({ event: "portfolio_item_denied", route: ROUTE, status: 404, reason: LogReason.ownershipDenied, userId: uid });
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const { data: updated, error } = await supabase
    .from("portfolio_items")
    .update(parsed.value)
    .eq("id", id)
    .eq("profile_id", uid)
    .select("id, title, description, year, tags")
    .maybeSingle();
  if (error || !updated) {
    logApiEvent({ event: "portfolio_item_failed", route: ROUTE, status: 500, reason: LogReason.upstreamError, userId: uid });
    return NextResponse.json({ error: "Could not save the work; please retry" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, item: updated });
}

/**
 * DELETE /api/portfolio/items/[id] — owner only, via the store's
 * single-lease lifecycle: unpublish (when published), remove public
 * objects, remove private originals, then the row. Failures keep
 * enough state for an idempotent retry (see deleteUnderLease).
 */
export async function DELETE(request: Request, context: RouteContext) {
  const crossOrigin = await deniedOrigin(request);
  if (crossOrigin) return crossOrigin;
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) {
    logApiEvent({ event: "portfolio_delete_denied", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid work identifier" }, { status: 400 });
  }

  const outcome = await deleteItem(supabase, uid, id);
  if (!outcome.ok) {
    logApiEvent({
      event: "portfolio_delete_failed",
      route: ROUTE,
      status: outcome.status,
      reason: outcome.status === 404 ? LogReason.ownershipDenied : outcome.status >= 500 ? LogReason.storageError : LogReason.upstreamError,
      userId: uid,
    });
    return NextResponse.json(
      { error: outcome.status === 404 ? NOT_FOUND : outcome.problem, hint: outcome.hint },
      { status: outcome.status },
    );
  }
  return NextResponse.json(outcome);
}

export const runtime = "nodejs";

export const maxDuration = 60;
