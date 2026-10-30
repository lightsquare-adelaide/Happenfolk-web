// Upload deterministic generated placeholders, restricted to marked sample accounts.
import dotenv from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { checked, sampleUsers } from "./seed-common.mjs";

export async function seedMedia(client) {
  const users = await sampleUsers(client);
  if (users.length !== 40) throw new Error("Expected 40 marked sample accounts; run db reset or seed-prod first");
  const ids = users.map((u) => u.id);
  const profiles = checked(await client.from("profiles").select("id,category_id").in("id", ids), "load sample profiles");
  const events = checked(await client.from("events").select("id,host_id,category_id").in("host_id", ids), "load sample events");
  const items = checked(await client.from("portfolio_items").select("id,profile_id").in("profile_id", ids), "load sample items");
  const palette = ["#9f4037", "#33697a", "#a16f22", "#65508c", "#396b50", "#96516a", "#516899"];
  async function image(index, width, height) {
    const color = palette[index % palette.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width * .32}" cy="${height * .4}" r="${height * .28}" fill="#eadfc7"/><path d="M0 ${height}L${width * .65} ${height * .2}L${width} ${height}Z" fill="#262c31"/><text x="24" y="${height - 24}" fill="white" font-size="24">SAMPLE DATA</text></svg>`;
    return sharp(Buffer.from(svg)).webp({ quality: 78 }).toBuffer();
  }
  async function upload(bucket, path, bytes) {
    checked(await client.storage.from(bucket).upload(path, bytes, { contentType: "image/webp", upsert: true }), `upload ${bucket}`);
  }
  let n = 0;
  for (const p of profiles) {
    const path = `${p.id}/sample/avatar.webp`;
    await upload("avatars", path, await image(p.category_id, 400, 400));
    checked(await client.from("profiles").update({ avatar_path: path }).eq("id", p.id), "wire avatar"); n++;
  }
  for (const e of events) {
    const path = `${e.host_id}/sample/${e.id}.webp`;
    await upload("covers", path, await image(e.category_id, 1200, 675));
    checked(await client.from("events").update({ cover_path: path }).eq("id", e.id), "wire cover"); n++;
  }
  for (const [i, item] of items.entries()) {
    for (const [variant, width, height] of [["medium", 960, 720], ["small", 480, 360]]) {
      const path = `${item.profile_id}/sample/${item.id}-${variant}.webp`;
      await upload("media", path, await image(i, width, height)); n++;
    }
  }
  console.log(`Uploaded ${n} generated sample images (${profiles.length} avatars, ${events.length} covers, ${items.length} works).`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    dotenv.config({ path: ".env.local", quiet: true });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Local media seed requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("seed:media is local only; use seed-prod --yes for a remote target");
    await seedMedia(createClient(url, key, { auth: { persistSession: false } }));
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
