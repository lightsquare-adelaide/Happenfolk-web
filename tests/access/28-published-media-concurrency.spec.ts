import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import pg from "pg";
import {
  admin, applyRedGuard, createPortfolioItem, createUser, guard, stackConfig,
  type TestUser,
} from "./_harness";

// Remove only the parent lock, preserving all publication/count checks.
// This counterfactual must fail because two transactions can otherwise
// each see the other's not-yet-committed media row and empty the work.
const migration = readFileSync(new URL(
  "../../supabase/migrations/20261026000300_portfolio_publish_media_guards.sql", import.meta.url,
), "utf8");
const start = migration.indexOf("create function public.media_assets_last_media_guard ()");
const end = migration.indexOf("\n$$;", start);
if (start < 0 || end < 0) throw new Error("Last-media guard definition not found");
const restore = migration.slice(start, end + 4).replace("create function", "create or replace function");
const broken = restore.replace(/\bfor update\s*;/i, ";");
if (broken === restore) throw new Error("The last-media lock counterfactual did not remove a lock");
guard("28-parent-lock-removed", broken, restore);

let owner: TestUser;
let undo: (() => Promise<void>) | null = null;
const connections: pg.Client[] = [];
beforeAll(async () => {
  undo = await applyRedGuard();
  owner = await createUser("media-concurrency-owner");
});
afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.end()));
  if (undo) await undo();
});

async function memberConnection() {
  const connection = new pg.Client({ connectionString: stackConfig().dbUrl });
  await connection.connect();
  connections.push(connection);
  await connection.query("begin");
  await connection.query("set local role authenticated");
  await connection.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: owner.userId, role: "authenticated" }),
  ]);
  return connection;
}

test("concurrent deletions cannot remove both final media rows", async () => {
  const item = await createPortfolioItem(owner, "Concurrent Publication", true);
  const added = await owner.client.from("media_assets").insert({
    portfolio_item_id: item.id, path: `${owner.userId}/concurrency-second.jpg`,
    alt_text: "A second reference image", content_type: "image/jpeg", bucket: "drafts",
  });
  expect(added.error).toBeNull();
  const media = await owner.client.from("media_assets").select("id").eq("portfolio_item_id", item.id);
  expect(media.error).toBeNull();
  expect(media.data).toHaveLength(2);
  const [first, second] = media.data!;
  const a = await memberConnection();
  const b = await memberConnection();
  let aOpen = true;
  try {
    await a.query("delete from public.media_assets where id = $1", [first.id]);
    const pid = Number((await b.query("select pg_backend_pid() as pid")).rows[0].pid);
    await b.query("set local statement_timeout = '5s'");
    const pending = b.query("delete from public.media_assets where id = $1", [second.id])
      .then(() => ({ error: null as Error | null }), (error: Error) => ({ error }));
    const observer = await admin();
    let sawWaiter = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { rows } = await observer.query("select cardinality(pg_blocking_pids($1)) > 0 as blocked", [pid]);
      if (rows[0].blocked) { sawWaiter = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await a.query("commit");
    aOpen = false;
    const result = await pending;
    await b.query("rollback");
    expect(sawWaiter, "the second deletion did not wait on the first transaction").toBe(true);
    expect(result.error?.message).toContain("without media");
    const remaining = await owner.client.from("media_assets").select("id").eq("portfolio_item_id", item.id);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toHaveLength(1);
    const published = await owner.client.from("portfolio_items").select("published").eq("id", item.id).single();
    expect(published.data?.published).toBe(true);
  } finally {
    if (aOpen) await a.query("rollback");
    await b.query("rollback").catch(() => {});
  }
});
