import { afterAll, beforeAll, expect, test } from "vitest";
import pg from "pg";
import { admin, stackConfig, } from "../access/_harness";
import { createUser, sessionCookieHeader, startApp, type TestUser } from "../media/_harness";
import { apiCall, expectFriendly } from "./_http";

/**
 * Optimistic-concurrency regression for PATCH /api/events/[id].
 *
 * The stale read is FORCED, not raced by luck: transaction A (direct
 * pg as the host under RLS) updates the event row and does not commit,
 * holding the row lock. The HTTP PATCH meanwhile validates against the
 * committed, now-stale updated_at and blocks on the same row. An
 * observer confirms a real lock waiter in pg_stat_activity before A
 * commits — only then does the losing write discover the row changed
 * and must answer 409 instead of overwriting A.
 */

let host: TestUser;
let hostCookie = "";
let eventId = "";
let app: { close: () => Promise<void> } | null = null;
const connections: pg.Client[] = [];

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.end()));
  if (app) await app.close();
  app = null;
});

beforeAll(async () => {
  app = await startApp();
  host = await createUser("events-conflict-host");
  hostCookie = await sessionCookieHeader(host.email, host.password);
  const created = await apiCall("POST", "/api/events", {
    cookie: hostCookie,
    body: {
      title: "Conflict Course", location: "Peel Street",
      starts_at: "2026-12-05T18:00:00+10:30",
    },
  });
  expect(created.status).toBe(201);
  eventId = String(created.json?.event?.id);
}, 600_000);

/** An open pg transaction as the host user, holding the event row. */
async function hostTransaction(): Promise<pg.Client> {
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

test("a stale-read edit loses with 409 after the row lock releases", async () => {
  const a = await hostTransaction();
  await a.query("update public.events set title = 'Concurrent winner' where id = $1", [eventId]);

  // Fire the HTTP edit. Its route reads the pre-A updated_at, then the
  // UPDATE blocks on A's row lock.
  const pending = apiCall("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { title: "Loser edit" },
  });

  // Prove the write actually raced: watch for a blocked backend whose
  // query is the versioned events update.
  const observer = await admin();
  let sawWaiter = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and state = 'active'
          and query ilike '%events%' and query ilike '%updated_at%'`,
    );
    if (rows[0].n > 0) { sawWaiter = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  await a.query("commit");
  const result = await pending;

  expect(sawWaiter, "the HTTP edit never waited on the open transaction").toBe(true);
  expectFriendly(result, 409, "changed while you were editing");

  // Winner's title stands; the loser's write did not land.
  const row = await host.client.from("events").select("title").eq("id", eventId).single();
  expect(row.error).toBeNull();
  expect(row.data?.title).toBe("Concurrent winner");
});

test("sequential edits from fresh reads still succeed", async () => {
  const first = await apiCall("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { title: "First Editor" },
  });
  expect(first.status).toBe(200);
  const second = await apiCall("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { title: "Second Editor" },
  });
  expect(second.status).toBe(200);
  const row = await host.client.from("events").select("title").eq("id", eventId).single();
  expect(row.data?.title).toBe("Second Editor");
});
