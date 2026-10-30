import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  admin,
  applyRedGuard,
  createUser,
  endConnections,
  guard,
  insertDraftItem,
  listOwnerOrder,
  userConnection,
  type TestUser,
} from "./_harness";

/**
 * Ordering mutations serialize on the OWNER's profile row: appends and
 * moves queue per artist, while different artists never wait on each
 * other. Red counterfactuals remove exactly one `for update` from each
 * function; both tests below must fail when their guard is applied
 * (ACCESS_RED=portfolio-move-lock-removed / portfolio-alloc-lock-removed).
 */
const migration = readFileSync(new URL(
  "../../supabase/migrations/20261026000800_portfolio_item_order_metadata.sql", import.meta.url,
), "utf8");

function sliceFunction(header: string): string {
  const start = migration.indexOf(header);
  const end = migration.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`definition not found: ${header}`);
  return migration.slice(start, end + 4).replace("create function", "create or replace function");
}

const moveRestore = sliceFunction("create function public.move_portfolio_item");
const moveBroken = moveRestore.replace(/\bfor update\s*;/i, ";");
if (moveBroken === moveRestore) throw new Error("move counterfactual removed no lock");
guard("portfolio-move-lock-removed", moveBroken, moveRestore);

const allocRestore = sliceFunction("create function public.portfolio_items_allocate_position");
const allocBroken = allocRestore.replace(/\bfor update\s*;/i, ";");
if (allocBroken === allocRestore) throw new Error("alloc counterfactual removed no lock");
guard("portfolio-alloc-lock-removed", allocBroken, allocRestore);

let undo: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undo = await applyRedGuard();
});

afterAll(async () => {
  await endConnections();
  if (undo) await undo();
});

/** Polls until `pid` is a real lock waiter (or the deadline passes). */
async function sawBlocker(pid: number, timeoutMs = 4000): Promise<boolean> {
  const observer = await admin();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      "select cardinality(pg_blocking_pids($1)) > 0 as blocked", [pid],
    );
    if (rows[0].blocked) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function backendPid(connection: pg.Client): Promise<number> {
  const { rows } = await connection.query("select pg_backend_pid() as pid");
  return Number(rows[0].pid);
}

describe("append allocation serializes per owner", () => {
  it("makes a concurrent insert a real lock waiter, then allocates unique positions", async () => {
    const user = await createUser("portfolio-conc-append");
    const a = await userConnection(user);
    const b = await userConnection(user);
    let aOpen = true;
    try {
      // A inserts and holds its transaction open: the allocation trigger
      // keeps the owner's profile row locked until A commits.
      await a.query(
        "insert into public.portfolio_items (profile_id, title, media_kind) values ($1, 'A', 'image')",
        [user.userId],
      );

      await b.query("set local statement_timeout = '10s'");
      const pidB = await backendPid(b);
      const pending = b.query(
        "insert into public.portfolio_items (profile_id, title, media_kind) values ($1, 'B', 'image')",
        [user.userId],
      ).then(() => null, (error: Error) => error);

      // Prove the race actually happened: B must be observed waiting on
      // A's uncommitted transaction before A commits.
      expect(await sawBlocker(pidB), "concurrent append did not wait on the profile lock").toBe(true);

      await a.query("commit");
      aOpen = false;
      const failure = await pending;
      expect(failure).toBeNull();
      await b.query("commit");

      const order = await listOwnerOrder(user.client, user.userId);
      expect(order.map((r) => r.position)).toEqual([0, 1]);
      expect(new Set(order.map((r) => r.id)).size).toBe(2);
    } finally {
      if (aOpen) await a.query("rollback");
      await b.query("rollback").catch(() => {});
    }
  });
});

describe("moves serialize per owner", () => {
  it("applies two concurrent down-moves of the same item in series", async () => {
    const user = await createUser("portfolio-conc-move");
    const x = await insertDraftItem(user.client, user.userId, "X");
    const y = await insertDraftItem(user.client, user.userId, "Y");
    const z = await insertDraftItem(user.client, user.userId, "Z");

    const a = await userConnection(user);
    const b = await userConnection(user);
    let aOpen = true;
    try {
      const moveA = await a.query("select public.move_portfolio_item($1, 'down') as moved", [x]);
      expect(moveA.rows[0].moved).toBe(true);

      await b.query("set local statement_timeout = '10s'");
      const pidB = await backendPid(b);
      const pending = b.query("select public.move_portfolio_item($1, 'down') as moved", [x])
        .then((r) => ({ moved: r.rows[0].moved as boolean, error: null as Error | null }),
          (error: Error) => ({ moved: null as boolean | null, error }));

      // B must queue on the same profile lock instead of reading A's
      // uncommitted pre-image of the list.
      expect(await sawBlocker(pidB), "concurrent move did not wait on the profile lock").toBe(true);

      await a.query("commit");
      aOpen = false;
      const result = await pending;
      expect(result.error).toBeNull();
      expect(result.moved).toBe(true);
      await b.query("commit");

      // Serialized: X passes Y, then Z. A stale-read second move would
      // leave [Y,X,Z] instead.
      const order = await listOwnerOrder(user.client, user.userId);
      expect(order.map((r) => r.id)).toEqual([y, z, x]);
      expect(order.map((r) => r.position)).toEqual([0, 1, 2]);
    } finally {
      if (aOpen) await a.query("rollback");
      await b.query("rollback").catch(() => {});
    }
  });

  it("does not serialize DIFFERENT owners against each other", async () => {
    const first = await createUser("portfolio-conc-first");
    const second: TestUser = await createUser("portfolio-conc-second");

    const a = await userConnection(first);
    try {
      // Hold the first owner's profile lock open mid-append.
      await a.query(
        "insert into public.portfolio_items (profile_id, title, media_kind) values ($1, 'Held', 'image')",
        [first.userId],
      );

      // The second owner's append and move run through the public API
      // (autocommit) and must not queue on a foreign profile lock.
      const started = Date.now();
      const ownItem = await insertDraftItem(second.client, second.userId, "Independent");
      const moved = await second.client.rpc("move_portfolio_item", {
        p_item_id: ownItem, p_direction: "up",
      });
      const elapsed = Date.now() - started;

      expect(moved.error).toBeNull();
      expect(moved.data).toBe(false); // single item: edge no-op
      expect(elapsed, "foreign owner operations waited on another owner's lock").toBeLessThan(5000);
      const order = await listOwnerOrder(second.client, second.userId);
      expect(order.map((r) => r.id)).toEqual([ownItem]);
    } finally {
      await a.query("rollback");
    }
  });
});
