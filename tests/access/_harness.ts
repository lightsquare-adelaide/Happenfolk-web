import { execSync } from "node:child_process";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared harness for the RLS/storage access-rule tests (BUILD_PLAN P1
 * scenarios 1-11 + 21-22).
 *
 * Ground rules (from the brief):
 * - Per-user Supabase clients only. Every assertion runs through RLS
 *   as anon or an authenticated user; NOTHING here uses service_role.
 * - The admin `pg` connection exists for FIXTURES and for the
 *   red-guard flips (break/restore a policy or trigger). It is the
 *   local postgres superuser, never a committed secret.
 * - Denials are asserted by DATA STATE (read back), never by status
 *   codes: under RLS an overreaching PATCH/DELETE is "204, zero rows".
 * - Red-green: run a file with ACCESS_RED=<guard-name> to break its
 *   guard; the file must FAIL. Run without ACCESS_RED to see it pass.
 */

export type TestUser = {
  client: SupabaseClient;
  userId: string;
  email: string;
};

type StackConfig = { url: string; anonKey: string; dbUrl: string };

let stack: StackConfig | null = null;

export function stackConfig(): StackConfig {
  if (stack) return stack;
  let out: string;
  try {
    out = execSync("supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Local kepler-vps shells need the docker group via sg(1).
    try {
      out = execSync('sg docker -c "supabase status -o env"', { encoding: "utf8" });
    } catch {
      throw new Error(
        "tests/access needs a running local Supabase stack and a readable" +
          " `supabase status`. Start it (supabase start)" +
          " and run `npm run test:access` — the CI invariants job provides" +
          " both on GitHub Actions.",
      );
    }
  }
  const kv: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+)=(.*)$/gm)) {
    kv[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  if (!kv.API_URL || !kv.ANON_KEY) {
    throw new Error("could not read local Supabase status (API_URL/ANON_KEY)");
  }
  stack = {
    url: kv.API_URL,
    anonKey: kv.ANON_KEY,
    dbUrl: kv.DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  };
  return stack;
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** Sessionless anonymous client; shared config across 8+ spec files. */
export function anonClient(): SupabaseClient {
  const { url, anonKey } = stackConfig();
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

/** Signs up a fresh user on the LOCAL stack and returns an authed client. */
export async function createUser(label: string): Promise<TestUser> {
  const { url, anonKey } = stackConfig();
  const email = `${label}-${runId}@access.test`;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signUp({
    email,
    password: `pw-${runId}-ok`,
  });
  if (error || !data.user || !data.session) {
    throw new Error(`signUp failed for ${label}: ${error?.message ?? "no session"}`);
  }
  return { client, userId: data.user.id, email };
}

let adminClient: pg.Client | null = null;

/** Local postgres superuser connection: fixtures + red-guard flips only. */
export async function admin(): Promise<pg.Client> {
  if (!adminClient) {
    adminClient = new pg.Client({ connectionString: stackConfig().dbUrl });
    await adminClient.connect();
  }
  return adminClient;
}

// ---------------- red-guard machinery ----------------

type Guard = { name: string; breakSql: string; restoreSql: string };

const guards: Guard[] = [];

/** Register a named way to break this file's protection for a red run. */
export function guard(name: string, breakSql: string, restoreSql: string): void {
  guards.push({ name, breakSql, restoreSql });
}

/**
 * In red mode, apply the matching guard and return its restore thunk
 * (call it in afterAll). Returns null in green mode.
 */
export async function applyRedGuard(): Promise<(() => Promise<void>) | null> {
  const red = process.env.ACCESS_RED;
  if (!red) return null;
  const g = guards.find((x) => x.name === red);
  if (!g) {
    throw new Error(
      `ACCESS_RED=${red} matches no guard in this file (have: ${guards.map((x) => x.name).join(", ") || "none"})`,
    );
  }
  const a = await admin();
  await a.query(g.breakSql);
  return async () => {
    await (await admin()).query(g.restoreSql);
  };
}


// ---------------- fixtures ----------------

export type EventRow = { id: string; title: string; host_id: string };

export async function createEvent(
  host: TestUser,
  title: string,
  status: "draft" | "published" = "published",
): Promise<EventRow> {
  const { data, error } = await host.client
    .from("events")
    .insert({
      host_id: host.userId,
      title,
      description: `${title} description`,
      status,
      starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    })
    .select("id, title, host_id")
    .single();
  if (error || !data) throw new Error(`createEvent failed: ${error?.message}`);
  return data;
}

export async function addCollaborator(
  host: TestUser,
  eventId: string,
  profileId: string,
): Promise<void> {
  const { error } = await host.client
    .from("event_collaborators")
    .insert({ event_id: eventId, profile_id: profileId, role: "collaborator" });
  if (error) throw new Error(`addCollaborator failed: ${error.message}`);
}

export type ItemRow = { id: string; title: string; profile_id: string };

/** Creates a portfolio item with one alt-texted media row. */
export async function createPortfolioItem(
  owner: TestUser,
  title: string,
  published: boolean,
): Promise<ItemRow> {
  const created = await owner.client
    .from("portfolio_items")
    .insert({
      profile_id: owner.userId,
      title,
      description: `${title} description`,
      media_kind: "image",
      published,
      published_at: published ? new Date().toISOString() : null,
    })
    .select("id, title, profile_id")
    .single();
  if (created.error || !created.data) {
    throw new Error(`createPortfolioItem failed: ${created.error?.message}`);
  }
  const media = await owner.client.from("media_assets").insert({
    portfolio_item_id: created.data.id,
    path: `media/${owner.userId}/${runId}-${title.replace(/\W+/g, "-")}.jpg`,
    alt_text: `${title} — alt text`,
    content_type: "image/jpeg",
    bucket: "media",
  });
  if (media.error) throw new Error(`createPortfolioItem media failed: ${media.error.message}`);
  return created.data;
}

/** Reads back one column value of one row, bypassing nothing. */
export async function readScalar(
  client: SupabaseClient,
  table: string,
  id: string,
  column: string,
): Promise<string | null | "MISSING_ROW"> {
  const { data, error } = await client
    .from(table)
    .select(column)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`readScalar failed: ${error.message}`);
  if (!data) return "MISSING_ROW";
  return (data as unknown as Record<string, unknown>)[column] as string;
}
