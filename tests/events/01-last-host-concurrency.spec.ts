import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import pg from "pg";
import {
  admin, applyRedGuard, createEvent, createUser, guard, stackConfig,
  type TestUser,
} from "../access/_harness";

// Remove only the parent-event lock, preserving the count and the
// cascade path. This counterfactual must fail: without the lock two
// transactions can each delete a different host row while the other's
// deletion is still uncommitted, both count a survivor, both commit,
// and the event ends up with zero hosts.
const migration = readFileSync(new URL(
  "../../supabase/migrations/20261026000700_event_location_last_host.sql", import.meta.url,
), "utf8");
const start = migration.indexOf("create function public.prevent_last_host_removal ()");
const end = migration.indexOf("\n$$;", start);
if (start < 0 || end < 0) throw new Error("Last-host guard definition not found");
const restore = migration.slice(start, end + 4).replace("create function", "create or replace function");
const broken = restore.replace(/\bfor update\s*;/i, ";");
if (broken === restore) throw new Error("The last-host lock counterfactual did not remove a lock");
guard("events-01-parent-lock-removed", broken, restore);

let host: TestUser;
let second: TestUser;
let undo: (() => Promise<void>) | null = null;
const connections: pg.Client[] = [];

beforeAll(async () => {
  undo = await applyRedGuard();
  host = await createUser("events-last-host-owner");
  second = await createUser("events-last-host-second");
});

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.end()));
  if (undo) await undo();
});

/** A pg transaction speaking to RLS as the host user (no service role). */
async function hostConnection() {
  const connection = new pg.Client({ connectionString: stackConfig().dbUrl });
  await connection.connect();
  connections.push(connection);
  await connection.query("begin");
  await connection.query("set local role authenticated");
  await connection.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: host.userId, role: "authenticated" }),
  ]);
  return connection;
}

test("concurrent host removals cannot leave the event without a host", async () => {
  const event = await createEvent(host, "Concurrent Roster", "draft");

  // Promote the second user to a host-role roster row. The 0007 insert
  // policy (is_event_host) allows the host to do this through RLS.
  const promoted = await host.client.from("event_collaborators").insert({
    event_id: event.id, profile_id: second.userId, role: "host",
  });
  expect(promoted.error).toBeNull();

  const a = await hostConnection();
  const b = await hostConnection();
  let aOpen = true;
  try {
    // Transaction A removes the second host but does not commit. Its
    // trigger holds the parent-event lock.
    await a.query(
      "delete from public.event_collaborators where event_id = $1 and profile_id = $2",
      [event.id, second.userId],
    );

    // Transaction B removes the ORIGINAL host row. Its trigger must
    // block on the same parent-event lock — the guard serialises roster
    // mutations per event instead of counting uncommitted state.
    const pid = Number((await b.query("select pg_backend_pid() as pid")).rows[0].pid);
    await b.query("set local statement_timeout = '5s'");
    const pending = b.query(
      "delete from public.event_collaborators where event_id = $1 and profile_id = $2",
      [event.id, host.userId],
    ).then(() => ({ error: null as Error | null }), (error: Error) => ({ error }));

    // Prove the race actually happened: observe B as a real waiter
    // before A commits. A Promise.all burst without this observation
    // proves nothing.
    const observer = await admin();
    let sawWaiter = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { rows } = await observer.query(
        "select cardinality(pg_blocking_pids($1)) > 0 as blocked", [pid],
      );
      if (rows[0].blocked) { sawWaiter = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    await a.query("commit");
    aOpen = false;
    const result = await pending;
    await b.query("rollback");

    expect(sawWaiter, "the second removal did not wait on the first transaction").toBe(true);
    expect(result.error?.message).toContain("LAST_HOST");

    // Committed state: exactly the original host row survives.
    const roster = await host.client.from("event_collaborators")
      .select("profile_id, role").eq("event_id", event.id);
    expect(roster.error).toBeNull();
    expect(roster.data).toHaveLength(1);
    expect(roster.data![0].profile_id).toBe(host.userId);
    expect(roster.data![0].role).toBe("host");
  } finally {
    if (aOpen) await a.query("rollback");
    await b.query("rollback").catch(() => {});
  }
});
