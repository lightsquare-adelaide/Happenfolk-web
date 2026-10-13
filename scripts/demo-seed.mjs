// Seeds one presentable demo account against a RUNNING local app +
// Supabase stack, through the real HTTP API (no service-role key).
//
//   node scripts/demo-seed.mjs http://127.0.0.1:3210
//
// Requires ffmpeg (synthesises its own demo images; nothing downloaded).
// Idempotent per email: a second run signs in instead of signing up.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServerClient } from "@supabase/ssr";

const run = promisify(execFile);
const appBase = process.argv[2] ?? "http://127.0.0.1:3210";
const email = process.env.DEMO_EMAIL ?? "wenheng.demo@happenfolk.local";
const password = process.env.DEMO_PASSWORD ?? "demo-Happenfolk-5800";

const { env } = process;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  // Fall back to .env.local so the script works with plain `node`.
  const raw = await readFile(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

// 1. Real sign-up / sign-in through @supabase/ssr with captured cookies.
const jar = [];
const client = createServerClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [],
      setAll(toSet) {
        for (const { name, value } of toSet) jar.push(`${name}=${value}`);
      },
    },
  },
);
const signUp = await client.auth.signUp({ email, password });
if (signUp.error && signUp.error.message.toLowerCase().includes("already")) {
  await client.auth.signInWithPassword({ email, password });
} else if (signUp.error) {
  throw new Error(`signUp failed: ${signUp.error.message}`);
}
const cookie = jar.join("; ");
const userId = signUp.data.user?.id;
console.log("session ready for", email);

// 2. Complete the profile straight in the database (RLS-checked as owner).
const profile = {
  category_id: 2, // Photography (seed 0002)
  account_kind: "individual",
  display_name: "Wenheng Demo",
  bio: "Multimedia, Storage & Deployment demo on the Happenfolk integration branch.",
  published: true,
};
if (userId) {
  const { error } = await client.from("profiles").update(profile).eq("id", userId);
  if (error) throw new Error(`profile update failed: ${error.message}`);
}
const { data: me } = await client.from("profiles").select("handle").eq("id", signUp.data.user?.id ?? "").single();
console.log("profile published at handle:", me?.handle);

// 3. Synthesise demo images (GPS included: the public derivatives must strip it).
const dir = await mkdtemp(path.join(tmpdir(), "happenfolk-demo-"));
try {
  const avatar = path.join(dir, "avatar.jpg");
  const artwork = path.join(dir, "artwork.jpg");
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=800x800:rate=15:duration=1", "-frames:v", "1", "-q:v", "2", avatar]);
  await run("exiftool", ["-overwrite_original", "-GPSLatitude=-34.9285", "-GPSLatitudeRef=S", "-GPSLongitude=138.5999", "-GPSLongitudeRef=E", "-Model=iPhone 15", avatar]);
  await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1600x1200:rate=15:duration=1", "-frames:v", "1", "-q:v", "2", artwork]);
  await run("exiftool", ["-overwrite_original", "-GPSLatitude=-34.9285", "-GPSLatitudeRef=S", "-GPSLongitude=138.5999", "-GPSLongitudeRef=E", "-ImageDescription=Adelaide test frame", artwork]);

  const post = (route, body, isForm) =>
    fetch(`${appBase}${route}`, {
      method: "POST",
      headers: isForm ? { cookie, origin: appBase } : { cookie, origin: appBase, "content-type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
    });

  // 4. Avatar through the real validated pipeline.
  const avatarForm = new FormData();
  avatarForm.append("file", new Blob([await readFile(avatar)], { type: "image/jpeg" }), "avatar.jpg");
  const avatarRes = await post("/api/media/avatar", avatarForm, true);
  console.log("avatar:", avatarRes.status, (await avatarRes.text()).slice(0, 90));

  // 5. One published artwork with alt text.
  const artForm = new FormData();
  artForm.append("file", new Blob([await readFile(artwork)], { type: "image/jpeg" }), "artwork.jpg");
  artForm.append("altText", "Synthesised Adelaide test frame for the local demo");
  const uploadRes = await post("/api/media/upload", artForm, true);
  const uploadBody = await uploadRes.json();
  console.log("upload:", uploadRes.status, JSON.stringify(uploadBody).slice(0, 90));
  const publishRes = await post("/api/media/publish", { itemId: uploadBody.itemId, altText: "Synthesised Adelaide test frame for the local demo" });
  console.log("publish:", publishRes.status);

  console.log(`\nDemo ready. Log in at ${appBase}/login — ${email} / ${password}`);
  console.log(`Public page: ${appBase}/artists/${me?.handle}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
