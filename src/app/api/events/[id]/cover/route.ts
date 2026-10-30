import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { logApiEvent, LogReason } from "@/lib/log";
import { isUuid } from "@/lib/events";
import { readUpload } from "@/lib/media/request";
import { deriveImageVariants, imageDimensions } from "@/lib/media/derive";
import { safeObjectPath, validateUpload } from "@/lib/media/validate";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/events/[id]/cover — multipart { file };
 * DELETE /api/events/[id]/cover — remove the cover.
 *
 * Cover is an ordinary edit: every listed collaborator may set it
 * (membership gate), not only the host. The upload rides the #20
 * pipeline instead of trusting the client:
 *
 * 1. readUpload — same-origin gate plus a bounded stream BEFORE any
 *    multipart parsing (the personal-version route called unbounded
 *    request.formData(); that is deliberately not ported).
 * 2. validateUpload — byte-level sniffing, so a renamed PDF is not a
 *    poster.
 * 3. imageDimensions — forces a real decode of the whole image; magic
 *    bytes alone are not accepted.
 * 4. deriveImageVariants — the object that reaches storage is a sharp
 *    re-encode. sharp copies NO metadata unless .withMetadata() is
 *    requested, so GPS and device tags from the original never enter
 *    the public bucket.
 * 5. safeObjectPath — the storage path is server-generated under the
 *    CALLER's uid folder (what the 0007 write policy pins), never
 *    derived from the file name.
 *
 * DISCLOSED LIMITATION (kept honest rather than papered over): the
 * `covers` bucket is public in 0007, so a cover is world-readable from
 * the moment it uploads — even while the event is still a draft. The
 * dashboard UI must state this before an upload starts. Cleanup is
 * caller-scoped: only objects under the caller's own uid folder are
 * ever removed, and the old path comes from a fresh server-side read,
 * never from client input. There is no privileged delete of an
 * arbitrary cover_path.
 */

async function requireCollaborator(supabase: SupabaseClient, uid: string, eventId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_event_collaborator", { p_event: eventId, p_member: uid });
  return data === true;
}

const NOT_FOUND = "Event not found or you are not a collaborator";

/** POST /api/events/[id]/cover */
export async function POST(request: Request, context: RouteContext) {
  const route = "/api/events/[id]/cover";
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_cover_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireCollaborator(supabase, user.id, id))) {
    logApiEvent({ event: "events_cover_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  // Bounded stream + multipart gate (origin re-checked inside).
  const upload = await readUpload(request);
  if (!upload.ok) return upload.response;
  const bytes = new Uint8Array(await upload.file.arrayBuffer());

  const verdict = validateUpload(bytes, upload.file.name);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.problem, ...(verdict.hint ? { hint: verdict.hint } : {}) }, { status: 400 });
  }
  if (verdict.value.contentType === "video/mp4") {
    return NextResponse.json({ error: "Cover must be an image (JPEG, PNG or WebP)" }, { status: 400 });
  }

  // Force an actual decode before storing anything.
  const dimensions = await imageDimensions(Buffer.from(bytes));
  if (!dimensions) {
    return NextResponse.json({ error: "Image is corrupt or cannot be decoded" }, { status: 400 });
  }
  let medium: Buffer;
  try {
    const variants = await deriveImageVariants(Buffer.from(bytes));
    medium = variants.find((variant) => variant.variant === "medium")?.data ?? variants[0].data;
  } catch {
    return NextResponse.json({ error: "Image is corrupt or cannot be processed" }, { status: 400 });
  }

  // Version token for the cover write: a cover upload must not
  // clobber a title edit that landed mid-flight.
  const { data: current } = await supabase
    .from("events")
    .select("updated_at, cover_path")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  const path = safeObjectPath(user.id, "webp");
  const stored = await supabase.storage.from("covers").upload(path, medium, {
    contentType: "image/webp",
    cacheControl: "3600",
  });
  if (stored.error) {
    logApiEvent({ event: "events_cover_failed", route, status: 500, reason: LogReason.storageError, userId: user.id });
    return NextResponse.json({ error: "Could not store the cover" }, { status: 500 });
  }

  const { data: applied, error } = await supabase
    .from("events")
    .update({ cover_path: path })
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (error || !applied || applied.length === 0) {
    // The row moved on (conflict) or the write was refused: roll back
    // the object WE just created. Only our own path is deleted — the
    // previous cover, wherever it lives, is untouched on failure.
    await supabase.storage.from("covers").remove([path]);
    if (error) {
      logApiEvent({ event: "events_cover_failed", route, status: 500, reason: LogReason.upstreamError, userId: user.id });
      return NextResponse.json({ error: "Could not attach the cover" }, { status: 500 });
    }
    return NextResponse.json(
      { error: "The event changed while you were editing. Reload and try again." },
      { status: 409 },
    );
  }

  let cleanupPending = false;
  const oldPath = current.cover_path;
  if (typeof oldPath === "string" && oldPath.startsWith(`${user.id}/`)) {
    const removed = await supabase.storage.from("covers").remove([oldPath]);
    cleanupPending = removed.error !== null;
  }
  const publicUrl = supabase.storage.from("covers").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, coverPath: path, publicUrl, coverIsPublic: true, cleanupPending });
}

/** DELETE /api/events/[id]/cover — any collaborator may remove the cover. */
export async function DELETE(request: Request, context: RouteContext) {
  const route = "/api/events/[id]/cover";
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_cover_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireCollaborator(supabase, user.id, id))) {
    logApiEvent({ event: "events_cover_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const { data: current } = await supabase
    .from("events")
    .select("updated_at, cover_path")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  if (!current.cover_path) return NextResponse.json({ ok: true, removed: false });

  const { data: applied, error } = await supabase
    .from("events")
    .update({ cover_path: null })
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (error) {
    logApiEvent({ event: "events_cover_failed", route, status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Could not remove the cover" }, { status: 500 });
  }
  if (!applied || applied.length === 0) {
    return NextResponse.json(
      { error: "The event changed while you were editing. Reload and try again." },
      { status: 409 },
    );
  }

  // Caller-scoped cleanup only: a path under someone else's uid folder
  // stays in place (removing it would exceed what 0007 allows anyway).
  let cleanupPending = false;
  if (current.cover_path.startsWith(`${user.id}/`)) {
    const removed = await supabase.storage.from("covers").remove([current.cover_path]);
    cleanupPending = removed.error !== null;
  }
  return NextResponse.json({ ok: true, removed: true, cleanupPending });
}
