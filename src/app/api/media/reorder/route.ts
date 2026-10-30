import { originProblem } from "@/lib/media/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentUserId, withMediaOperation } from "@/lib/media/store";

/**
 * POST /api/media/reorder — JSON { itemId, assetId, direction }.
 * Swaps an original asset with its adjacent neighbour by `position`.
 * Both rows belong to the caller's item (RLS + explicit check), so
 * the swap cannot touch anyone else's ordering.
 */
export async function POST(request: Request) {
  const crossOrigin = originProblem(request);
  if (crossOrigin) return crossOrigin;
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { itemId?: unknown; assetId?: unknown; direction?: unknown };
  try {
    body = (await request.json()) as typeof body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid JSON body");
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const { itemId, assetId, direction } = body;
  if (typeof itemId !== "string" || typeof assetId !== "string" || (direction !== "up" && direction !== "down")) {
    return NextResponse.json({ error: "Incomplete parameters" }, { status: 400 });
  }

  const { data: item } = await supabase
    .from("portfolio_items")
    .select("id, profile_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || item.profile_id !== uid) {
    return NextResponse.json({ error: "Work item not found or not owned by this account" }, { status: 404 });
  }

  const outcome = await withMediaOperation(supabase, uid, itemId, async () => {
    const { data, error } = await supabase.rpc("reorder_media", {
      p_item_id: itemId, p_asset_id: assetId, p_direction: direction,
    });
    if (error) return { ok: false as const, status: 400, problem: "Could not reorder this media" };
    return { ok: true as const, moved: data === true };
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.problem }, { status: outcome.status });
  return NextResponse.json(outcome);
}

export const runtime = "nodejs";

export const maxDuration = 60;
