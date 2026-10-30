import { createClient } from "@supabase/supabase-js";
import { artists, sampleContent, SAMPLE_TAG } from "./fixtures/sample-data.mjs";

export function checked(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}
export function remoteClient() {
  if (!process.argv.includes("--yes")) throw new Error("Remote sample operation requires --yes");
  const { SEED_SUPABASE_URL: url, SEED_SERVICE_ROLE_KEY: key, SEED_TARGET: target } = process.env;
  if (!url || !key || !target) throw new Error("Set SEED_SUPABASE_URL, SEED_SERVICE_ROLE_KEY and SEED_TARGET explicitly; .env.local is never used.");
  const parsed = new URL(url);
  if (parsed.host !== target) throw new Error("SEED_TARGET must match the exact URL host (including port)");
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Remote sample operations require HTTPS");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function sampleUsers(client) {
  const found = [];
  for (let page = 1; ; page++) {
    const { users } = checked(await client.auth.admin.listUsers({ page, perPage: 100 }), "list users");
    found.push(...users.filter((u) => u.app_metadata?.sample_tag === SAMPLE_TAG && artists.some((a) => a.email === u.email)));
    if (users.length < 100) break;
  }
  return found;
}
export async function seedData(client, password) {
  if (!password || password.length < 16) throw new Error("SEED_PASSWORD must have at least 16 characters; remote accounts have no default password");
  const existing = await sampleUsers(client);
  const ids = [];
  for (const artist of artists) {
    let user = existing.find((u) => u.email === artist.email);
    if (!user) {
      user = checked(await client.auth.admin.createUser({ email: artist.email, password, email_confirm: true,
        app_metadata: { sample_tag: SAMPLE_TAG } }), `create ${artist.handle}`).user;
    }
    if (!user) throw new Error("Sample user creation returned no user");
    ids.push(user.id);
    const { email, id, ...profile } = artist;
    void email; void id;
    checked(await client.from("profiles").update(profile).eq("id", user.id), "update sample profile");
  }
  const { events, items, media, collaborators } = sampleContent(ids);
  // Refuse deterministic-ID collisions instead of taking over unrelated content.
  for (const [table, rows, owner] of [["events", events, "host_id"], ["portfolio_items", items, "profile_id"]]) {
    const current = checked(await client.from(table).select(`id,${owner}`).in("id", rows.map((r) => r.id)), `check ${table}`);
    if (current.some((r) => !ids.includes(r[owner]))) throw new Error(`Sample ID collision in ${table}`);
  }
  checked(await client.from("events").upsert(events), "seed events");
  // Do not unpublish existing samples on retries. Their media remains valid.
  const current = checked(await client.from("portfolio_items").select("id,published").in("id", items.map((r) => r.id)), "load sample items");
  const publication = new Map(current.map((r) => [r.id, r.published]));
  checked(await client.from("portfolio_items").upsert(items.map((r) => ({ ...r, published: publication.get(r.id) ?? false }))), "seed items");
  checked(await client.from("media_assets").upsert(media), "seed media metadata");
  checked(await client.from("event_collaborators").upsert(collaborators), "seed collaborators");
  checked(await client.from("portfolio_items").update({ published: true }).in("id", items.slice(0, 118).map((r) => r.id)), "publish sample works");
  return { profiles: ids.length, events: events.length, items: items.length };
}
export async function removeSampleData(client) {
  const users = await sampleUsers(client);
  for (const user of users) {
    await removeUserStorage(client, user.id);
    // Polymorphic analytics/likes do not have subject foreign keys.
    const items = checked(await client.from("portfolio_items").select("id").eq("profile_id", user.id), "sample items");
    const events = checked(await client.from("events").select("id").eq("host_id", user.id), "sample events");
    const subjects = [user.id, ...items.map((r) => r.id), ...events.map((r) => r.id)];
    for (const table of ["page_views", "page_views_monthly", "interactions"]) {
      checked(await client.from(table).delete().in("subject_id", subjects), `clean ${table}`);
    }
    checked(await client.auth.admin.deleteUser(user.id), "delete sample account");
  }
  return users.length;
}
export async function removeUserStorage(client, userId) {
  for (const bucket of ["avatars", "covers", "media", "drafts"]) {
    async function walk(prefix) {
      // Delete each page before listing again so offsets cannot skip rows.
      for (;;) {
        const rows = checked(await client.storage.from(bucket).list(prefix, { limit: 100 }), "list cleanup objects");
        if (!rows.length) return;
        for (const row of rows) {
          const path = `${prefix}/${row.name}`;
          if (row.id) checked(await client.storage.from(bucket).remove([path]), "remove object");
          else await walk(path);
        }
        if (rows.length < 100) return;
      }
    }
    await walk(userId);
  }
}
