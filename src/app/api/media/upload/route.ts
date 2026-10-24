import { readUpload } from "@/lib/media/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateUpload } from "@/lib/media/validate";
import { currentUserId, uploadMaster } from "@/lib/media/store";
import { LogReason, logApiEvent } from "@/lib/log";

const ROUTE = "/api/media/upload";

/**
 * POST /api/media/upload — multipart/form-data:
 *   file: File (required)   itemId?: string   altText?: string
 *
 * Authorization via getUser(); the sniffed — never declared — content
 * type decides the verdict. Returns 201 with the stored asset facts or
 * 4xx/5xx { error, hint? }.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) {
    logApiEvent({ event: "media_upload_failed", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const upload = await readUpload(request);
  if (!upload.ok) return upload.response;
  const { file, altText, itemId } = upload;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = validateUpload(bytes, file.name);
  if (!verdict.ok) {
    logApiEvent({ event: "media_upload_failed", route: ROUTE, status: 400, reason: LogReason.invalidContent, userId: uid });
    return NextResponse.json({ error: verdict.problem, hint: verdict.hint }, { status: 400 });
  }

  const outcome = await uploadMaster(supabase, uid, bytes, verdict.value, {
    itemId: typeof itemId === "string" && itemId.length > 0 ? itemId : undefined,
    altText: typeof altText === "string" ? altText : undefined,
  });
  if (!outcome.ok) {
    logApiEvent({ event: "media_upload_failed", route: ROUTE, status: outcome.status, reason: outcome.status >= 500 ? LogReason.storageError : LogReason.upstreamError, userId: uid });
    return NextResponse.json({ error: outcome.problem, hint: outcome.hint }, { status: outcome.status });
  }
  // P4: an item may hold both images and a video; portfolio_items.
  // media_kind is the item's PRIMARY kind, pinned by its FIRST media.
  // Count before deciding so later uploads never flip the kind.
  if (typeof itemId === "string" && itemId.length > 0) {
    const { count } = await supabase
      .from("media_assets")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_item_id", itemId)
      .eq("variant", "original");
    if ((count ?? 0) <= 1) {
      await supabase
        .from("portfolio_items")
        .update({ media_kind: verdict.value.contentType === "video/mp4" ? "video" : "image" })
        .eq("id", itemId)
        .eq("profile_id", uid);
    }
  }
  return NextResponse.json(outcome, { status: 201 });
}

export const runtime = "nodejs";

export const maxDuration = 60;
