import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { checked, removeUserStorage } from "./seed-common.mjs";
dotenv.config({ path: ".env.local", quiet: true });

export function runtime({ cleanup = false } = {}) {
  const base = (process.env.BASE_URL || process.argv[2] || "").replace(/\/$/, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !url || !key || (cleanup && !secret)) throw new Error("Set BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and (for e2e cleanup) SUPABASE_SERVICE_ROLE_KEY");
  new URL(base);
  return { base, url, key, publicClient: createClient(url, key, { auth: { persistSession: false } }),
    admin: secret ? createClient(url, secret, { auth: { persistSession: false } }) : null };
}
export function assert(ok, label) {
  if (!ok) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}
export async function request(base, path, { cookie, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== "GET") h.origin = base;
  if (body !== undefined && !(body instanceof FormData)) {
    h["content-type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* HTML is expected for pages. */ }
  return { status: res.status, headers: res.headers, text, json };
}
export async function signup(config, label) {
  const jar = new Map();
  const client = createServerClient(config.url, config.key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
  } });
  const token = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const { user, session } = checked(await client.auth.signUp({ email: `${label}-${token}@example.test`, password: `Example-${token}-Aa1!` }), "sign up");
  // Return the user even when confirmations are enabled so finally can remove it.
  return { client, user, session, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}
export async function cleanupAccount(admin, userId) {
  await removeUserStorage(admin, userId);
  const items = checked(await admin.from("portfolio_items").select("id").eq("profile_id", userId), "cleanup works");
  const events = checked(await admin.from("events").select("id").eq("host_id", userId), "cleanup events");
  const subjects = [userId, ...items.map((r) => r.id), ...events.map((r) => r.id)];
  for (const table of ["page_views", "page_views_monthly", "interactions"]) {
    checked(await admin.from(table).delete().in("subject_id", subjects), `cleanup ${table}`);
  }
  checked(await admin.from("page_views").delete().eq("viewer_id", userId), "cleanup member views");
  checked(await admin.auth.admin.deleteUser(userId), "cleanup account");
  console.log("PASS cleanup account, storage and owned content");
}
