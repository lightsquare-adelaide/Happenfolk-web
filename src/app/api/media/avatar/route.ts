import { readUpload } from "@/lib/media/request";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateUpload, safeObjectPath } from "@/lib/media/validate";
import { currentUserId } from "@/lib/media/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const upload = await readUpload(request);
  if (!upload.ok) return upload.response;
  const { file } = upload;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = validateUpload(bytes, file.name);
  if (!verdict.ok) return NextResponse.json({ error: verdict.problem }, { status: 400 });
  if (verdict.value.contentType === "video/mp4") return NextResponse.json({ error: "Choose a JPEG, PNG or WebP avatar" }, { status: 400 });
  let image: Buffer;
  try { image = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().resize(256, 256, { fit: "cover" }).webp().toBuffer(); }
  catch { return NextResponse.json({ error: "Image is corrupt or too large to process" }, { status: 400 }); }
  const token = crypto.randomUUID();
  const claim = await supabase.rpc("claim_avatar_operation", {p_token: token});
  if (claim.error) return NextResponse.json({error: "Could not start avatar upload"}, {status: 500});
  if (claim.data !== true) return NextResponse.json({error: "Another avatar upload is in progress. Try again shortly."}, {status: 409});
  try {
  const { data: profile } = await supabase.from("profiles").select("handle, avatar_path").eq("id", uid).single();
  if (!profile) return NextResponse.json({ error: "Profile unavailable" }, { status: 404 });
  const path = safeObjectPath(uid, "webp");
  const stored = await supabase.storage.from("avatars").upload(path, image, { contentType: "image/webp", cacheControl: "3600" });
  if (stored.error) return NextResponse.json({ error: "Could not store avatar" }, { status: 500 });
  const saved = await supabase.from("profiles").update({ avatar_path: path }).eq("id", uid).select("id").single();
  if (saved.error) {
    await supabase.storage.from("avatars").remove([path]);
    return NextResponse.json({ error: "Could not update avatar" }, { status: 500 });
  }
  let cleanupPending = false;
  if (profile.avatar_path?.startsWith(`${uid}/`)) {
    const removed = await supabase.storage.from("avatars").remove([profile.avatar_path]);
    cleanupPending = removed.error !== null;
  }
  revalidatePath("/dashboard/profile"); revalidatePath(`/artists/${profile.handle}`);
  return NextResponse.json({ ok: true, path, cleanupPending }, { status: 201 });
  } finally { await supabase.rpc("release_avatar_operation", {p_token: token}); }
}

export const maxDuration = 60;
