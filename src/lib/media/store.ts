import type { SupabaseClient } from "@supabase/supabase-js";
import { safeObjectPath, variantObjectPath, type ValidatedUpload } from "./validate";
import { deriveImageVariants, imageDimensions } from "./derive";

/**
 * Media storage pipeline. Every storage/database operation runs with
 * the CALLER'S session client, so the 0007 RLS policies (own-uid
 * folder only) remain the single authority — no service-role key is
 * involved anywhere in this module.
 *
 * Publishing model (order matters):
 *   upload    master bytes -> drafts/{uid}/{uuid}.{ext} (private, forever)
 *   publish   derivatives -> media/ (public) THEN item.published = true
 *   unpublish masters verified present -> public objects deleted THEN
 *             published = false
 *
 * Why these orders: the DB flag describes a storage state that already
 * exists, never one that is still pending. Failures therefore fail in
 * the safe direction (an unpublished item may leave stray public
 * derivatives behind — retry/remove heals; the private master is only
 * ever read, never moved or deleted, so "both buckets empty" is
 * impossible). Every step is idempotent, so re-running a failed
 * publish/unpublish converges.
 */

export type PipelineFailure = { ok: false; status: number; problem: string; hint?: string };

function fail(status: number, problem: string, hint?: string): PipelineFailure {
  return { ok: false, status, problem, hint };
}

/** The acting user's id, or null when the session is missing/invalid. */
export async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function loadOwnedItem(supabase: SupabaseClient, uid: string, itemId: string) {
  const { data } = await supabase
    .from("portfolio_items")
    .select("id, profile_id, title, media_kind, published")
    .eq("id", itemId)
    .maybeSingle();
  if (!data || data.profile_id !== uid) return null;
  return data as { id: string; profile_id: string; title: string; media_kind: string; published: boolean };
}

/**
 * Creates the draft portfolio item an upload hangs on. P4 owns real
 * item CRUD; this only provisions the row the pipeline requires.
 */
export async function createDraftItem(
  supabase: SupabaseClient,
  uid: string,
  mediaKind: "image" | "video",
): Promise<{ ok: true; itemId: string } | PipelineFailure> {
  const { data, error } = await supabase
    .from("portfolio_items")
    .insert({ profile_id: uid, title: "Untitled", media_kind: mediaKind })
    .select("id")
    .single();
  if (error || !data) return fail(500, `Failed to create the draft item: ${error?.message ?? "no row"}`);
  return { ok: true, itemId: data.id as string };
}

/** Next position for an item's media rows (append ordering). */
async function nextPosition(supabase: SupabaseClient, itemId: string): Promise<number> {
  const { count } = await supabase
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("portfolio_item_id", itemId)
    .eq("variant", "original");
  return count ?? 0;
}

export type UploadOutcome =
  | {
      ok: true;
      itemId: string;
      assetId: string;
      path: string;
      contentType: string;
      width: number | null;
      height: number | null;
    }
  | PipelineFailure;

/**
 * Upload gate + master storage. Sniffs bytes (never client claims),
 * stores the master in the private drafts bucket under
 * `{uid}/{uuid}.{ext}`, and records the original media_assets row.
 */
async function uploadUnderLease(
  supabase: SupabaseClient,
  uid: string,
  bytes: Uint8Array,
  validated: ValidatedUpload,
  opts: { itemId?: string; altText?: string } = {},
): Promise<UploadOutcome> {
  // Images: authoritative dimensions from the decoder; also rejects
  // files whose magic bytes look right but which cannot decode.
  let width = validated.width;
  let height = validated.height;
  if (validated.contentType !== "video/mp4") {
    const dims = await imageDimensions(Buffer.from(bytes));
    if (!dims) {
      return fail(400, "Image file is corrupt and cannot be decoded");
    }
    width = dims.width;
    height = dims.height;
  }

  let itemId = opts.itemId;
  if (itemId) {
    const item = await loadOwnedItem(supabase, uid, itemId);
    if (!item) return fail(404, "Work item not found or not owned by this account");
    if (item.published) return fail(409, "Unpublish this work before adding media");
  } else {
    const kind = validated.contentType === "video/mp4" ? "video" : "image";
    const created = await createDraftItem(supabase, uid, kind);
    if (!created.ok) return created;
    itemId = created.itemId;
  }

  const path = safeObjectPath(uid, validated.ext);
  const { error: uploadError } = await supabase.storage.from("drafts").upload(path, bytes, {
    contentType: validated.contentType,
  });
  if (uploadError) return fail(500, `Failed to store the master: ${uploadError.message}`);


  const { data: asset, error: insertError } = await supabase
    .from("media_assets")
    .insert({
      portfolio_item_id: itemId,
      path,
      alt_text: opts.altText?.trim() || null,
      content_type: validated.contentType,
      width,
      height,
      bucket: "drafts",
      variant: "original",
      position: await nextPosition(supabase, itemId),
    })
    .select("id")
    .single();
  if (insertError || !asset) {
    await supabase.storage.from("drafts").remove([path]);
    return fail(500, `Failed to record the media: ${insertError?.message ?? "no row"}`);
  }
  return {
    ok: true,
    itemId,
    assetId: asset.id as string,
    path,
    contentType: validated.contentType,
    width,
    height,
  };
}

type OriginalAsset = {
  id: string;
  path: string;
  alt_text: string | null;
  content_type: string;
  width: number | null;
  height: number | null;
  position: number;
};

async function loadOriginals(supabase: SupabaseClient, itemId: string): Promise<OriginalAsset[]> {
  const { data, error, count } = await supabase
    .from("media_assets")
    .select(
      "id, portfolio_item_id, path, alt_text, content_type, width, height, bucket, variant, position", {count: "exact"},
    )
    .eq("portfolio_item_id", itemId)
    .eq("bucket", "drafts")
    .eq("variant", "original")
    .order("position");
  if (error || (count !== null && count > (data?.length ?? 0))) throw new Error("Could not load all original media");
  return (data ?? []) as OriginalAsset[];
}

async function downloadMaster(supabase: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data } = await supabase.storage.from("drafts").download(path);
  if (!data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Public URL for an object in the media bucket. */
export function publicMediaUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export type PublishOutcome = { ok: true; published: true; publicPaths: string[] } | PipelineFailure;

/**
 * Publish: derivatives into the public bucket, variant rows, THEN the
 * published flag. Re-runnable; uploads upsert so a retry after a
 * partial failure converges instead of duplicating objects.
 */
async function publishUnderLease(
  supabase: SupabaseClient,
  uid: string,
  itemId: string,
  opts: { altText?: string } = {},
): Promise<PublishOutcome> {
  const item = await loadOwnedItem(supabase, uid, itemId);
  if (!item) return fail(404, "Work item not found or not owned by this account");

  if (opts.altText !== undefined) {
    const trimmed = opts.altText.trim();
    if (!trimmed) return fail(400, "alt text cannot be empty: describe what this work shows");
    const { error } = await supabase
      .from("media_assets")
      .update({ alt_text: trimmed })
      .eq("portfolio_item_id", itemId)
      .eq("bucket", "drafts")
      .eq("variant", "original");
    if (error) return fail(500, `Failed to save alt text: ${error.message}`);
  }

  const originals = await loadOriginals(supabase, itemId);
  if (originals.length === 0) return fail(400, "No media to publish: upload some first");
  const missingAlt = originals.find((a) => !a.alt_text || a.alt_text.trim().length === 0);
  if (missingAlt) return fail(400, "Every media item needs alt text before publishing (enforced server-side; the frontend hint is just a helper)");

  // Preflight every master before exposing even the first display object.
  const masters = new Map<string, Uint8Array>();
  for (const original of originals) {
    const master = await downloadMaster(supabase, original.path);
    if (!master) return fail(500, "A private master is missing; publication aborted");
    if (original.content_type !== "video/mp4" && !await imageDimensions(Buffer.from(master))) {
      return fail(400, "A private image cannot be decoded; publication aborted");
    }
    masters.set(original.path, master);
  }
  const publicPaths: string[] = [];
  async function abortPublication(problem: string): Promise<PipelineFailure> {
    if (!item!.published && publicPaths.length) {
      const removed = await supabase.storage.from("media").remove(publicPaths);
      if (!removed.error) await supabase.from("media_assets").delete().eq("portfolio_item_id", itemId).eq("bucket", "media").in("path", publicPaths);
      else return fail(500, "Publication failed; public cleanup needs a retry");
    }
    return fail(500, problem);
  }
  try {
  for (const original of originals) {
    const master = masters.get(original.path)!;

    if (original.content_type === "video/mp4") {
      // No transcoding by design (P3 decision): the validated H.264
      // master is byte-copied as the public display object.
      const displayPath = variantObjectPath(original.path, "display", "mp4");
      const { error } = await supabase.storage.from("media").upload(displayPath, master, {
        contentType: "video/mp4",
        upsert: true,
      });
      if (error) return abortPublication("Could not store the public copy");
      publicPaths.push(displayPath);
      const { error: rowError } = await supabase.from("media_assets").upsert({
        portfolio_item_id: itemId,
        path: displayPath,
        alt_text: original.alt_text,
        content_type: "video/mp4",
        width: original.width,
        height: original.height,
        bucket: "media",
        variant: "display",
        position: original.position,
      }, { onConflict: "portfolio_item_id,path,bucket,variant" });
      if (rowError) return abortPublication("Could not record the public copy");
    } else {
      const variants = await deriveImageVariants(Buffer.from(master));
      for (const variant of variants) {
        const variantPath = variantObjectPath(original.path, variant.variant, "webp");
        const { error } = await supabase.storage.from("media").upload(variantPath, variant.data, {
          contentType: variant.contentType,
          upsert: true,
        });
        if (error) return abortPublication("Could not store the public copy");
        publicPaths.push(variantPath);
        const { error: rowError } = await supabase.from("media_assets").upsert({
          portfolio_item_id: itemId,
          path: variantPath,
          alt_text: original.alt_text,
          content_type: variant.contentType,
          width: variant.width,
          height: variant.height,
          bucket: "media",
          variant: variant.variant,
          position: original.position,
        }, { onConflict: "portfolio_item_id,path,bucket,variant" });
        if (rowError) return abortPublication("Could not record the public copy");
      }
    }
  }

  const { error: flagError } = await supabase
    .from("portfolio_items")
    .update({ published: true, published_at: new Date().toISOString() })
    .eq("id", itemId);
  if (flagError) return abortPublication("Could not publish the work");
  return { ok: true, published: true, publicPaths };
  } catch { return abortPublication("Image processing failed; please retry"); }
}

export type UnpublishOutcome = { ok: true; unpublished: true } | PipelineFailure;

/**
 * Unpublish: verify every private master is still present, delete the
 * public objects, delete the public variant rows, flip the flag.
 * Steps are individually idempotent; a failed run is healed by
 * re-running. The master bytes are never touched, so no sequence of
 * failures can leave "both buckets empty".
 */
async function unpublishUnderLease(
  supabase: SupabaseClient,
  uid: string,
  itemId: string,
): Promise<UnpublishOutcome> {
  const item = await loadOwnedItem(supabase, uid, itemId);
  if (!item) return fail(404, "Work item not found or not owned by this account");

  const originals = await loadOriginals(supabase, itemId);
  for (const original of originals) {
    const master = await downloadMaster(supabase, original.path);
    if (!master) {
      return fail(500, `Master not in the private bucket (${original.path}); unpublish refused: never leave the work in neither bucket`);
    }
  }

  const { data: publicRows, error: publicRowError, count: publicCount } = await supabase
    .from("media_assets")
    .select("id, path", {count: "exact"})
    .eq("portfolio_item_id", itemId)
    .eq("bucket", "media");
  if (publicRowError || (publicCount !== null && publicCount > (publicRows?.length ?? 0))) return fail(500, "Could not load all public media; unpublish aborted");
  const publicRowsList = (publicRows ?? []) as { id: string; path: string }[];

  // Deterministic paths also remove objects left by a crashed publication,
  // without a truncated folder listing or dependence on public DB rows.
  const expected = originals.flatMap(original => original.content_type === "video/mp4"
    ? [variantObjectPath(original.path, "display", "mp4")]
    : [variantObjectPath(original.path, "small"), variantObjectPath(original.path, "medium")]);
  const toRemove = [...new Set([...publicRowsList.map(row => row.path), ...expected])];
  if (toRemove.length > 0) {
    const { error } = await supabase.storage.from("media").remove(toRemove);
    if (error) return fail(500, `Failed to delete the public copy (retry to restore consistency): ${error.message}`);
  }

  if (publicRowsList.length > 0) {
    const { error } = await supabase
      .from("media_assets")
      .delete()
      .in(
        "id",
        publicRowsList.map((r) => r.id),
      );
    if (error) return fail(500, `Failed to delete the public copy record (retry to restore consistency): ${error.message}`);
  }

  const { error: flagError } = await supabase
    .from("portfolio_items")
    .update({ published: false, published_at: null })
    .eq("id", itemId);
  if (flagError) return fail(500, `Failed to flip the published flag (retry to restore consistency): ${flagError.message}`);
  return { ok: true, unpublished: true };
}

/** Exclusive per-work transitions; leases expire after a crashed process. */
export async function withMediaOperation<T extends { ok: boolean }>(
  supabase: SupabaseClient, uid: string, itemId: string, operation: () => Promise<T>,
): Promise<T | PipelineFailure> {
  const item = await loadOwnedItem(supabase, uid, itemId);
  if (!item) return fail(404, "Work item not found or not owned by this account");
  const token = crypto.randomUUID();
  const claim = await supabase.rpc("claim_media_operation", { p_item_id: itemId, p_token: token });
  if (claim.error) return fail(500, "Could not start media operation");
  if (claim.data !== true) return fail(409, "Another media operation is in progress. Try again shortly.");
  try { return await operation(); }
  catch { return fail(500, "Media operation failed. Please retry."); }
  finally { await supabase.rpc("release_media_operation", { p_item_id: itemId, p_token: token }); }
}

export async function publishItem(supabase: SupabaseClient, uid: string, itemId: string, opts: {altText?: string} = {}): Promise<PublishOutcome> {
  return withMediaOperation(supabase, uid, itemId, () => publishUnderLease(supabase, uid, itemId, opts));
}
export async function unpublishItem(supabase: SupabaseClient, uid: string, itemId: string): Promise<UnpublishOutcome> {
  return withMediaOperation(supabase, uid, itemId, () => unpublishUnderLease(supabase, uid, itemId));
}
export async function uploadMaster(supabase: SupabaseClient, uid: string, bytes: Uint8Array, validated: ValidatedUpload, opts: {itemId?: string; altText?: string} = {}): Promise<UploadOutcome> {
  const operation = () => uploadUnderLease(supabase, uid, bytes, validated, opts);
  return opts.itemId ? withMediaOperation(supabase, uid, opts.itemId, operation) : operation();
}
