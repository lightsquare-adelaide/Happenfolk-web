import { afterAll, beforeAll, expect, test } from "vitest";
import {
  admin, applyRedGuard, createEvent, createUser, guard,
  type TestUser,
} from "../access/_harness";

// Red counterfactual: recreate the trigger with the OLD event list
// (delete or update of role only). Under it, a host-role row can leave
// its event by changing event_id or profile_id while the role stays
// 'host', and the old event silently loses its last host. The move
// tests below must fail when this guard is applied.
const broken = `
drop trigger if exists trg_prevent_last_host_removal on public.event_collaborators;
create trigger trg_prevent_last_host_removal
  before delete or update of role
  on public.event_collaborators
  for each row
  execute function public.prevent_last_host_removal ();
`;
const restore = `
drop trigger if exists trg_prevent_last_host_removal on public.event_collaborators;
create trigger trg_prevent_last_host_removal
  before delete or update of role, event_id, profile_id
  on public.event_collaborators
  for each row
  execute function public.prevent_last_host_removal ();
`;
guard("events-02-role-only-trigger", broken, restore);

let host: TestUser;
let second: TestUser;
let undo: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undo = await applyRedGuard();
  host = await createUser("events-reassign-host");
  second = await createUser("events-reassign-second");
});

afterAll(async () => {
  if (undo) await undo();
});

/**
 * Reassignment runs through the local superuser because the API role
 * has no UPDATE privilege on event_collaborators at all
 * (20261013000100 grants insert and delete only). The trigger is the
 * invariant's last line of defence for privileged writers — the owner
 * role, service_role, and any future migration that opens updates.
 */
async function expectLastHostRejected(sql: string, params: unknown[]) {
  const a = await admin();
  const result = await a.query(sql, params).then(
    () => ({ error: null as Error | null }),
    (error: Error) => ({ error }),
  );
  expect(result.error, `expected LAST_HOST rejection for: ${sql}`).not.toBeNull();
  expect(result.error!.message).toContain("LAST_HOST");
}

test("demoting the last host to collaborator is rejected", async () => {
  const event = await createEvent(host, "Demotion Target", "draft");
  await expectLastHostRejected(
    "update public.event_collaborators set role = 'collaborator' where event_id = $1 and profile_id = $2",
    [event.id, host.userId],
  );
});

test("moving the last host row to another event is rejected", async () => {
  const event = await createEvent(host, "Move Source", "draft");
  // Destination hosted by `second`, so the moving row has no existing
  // (destination, host) roster row: under the red counterfactual the
  // move must SUCCEED and lose the invariant, not fail on a primary-key
  // collision with the destination creator's own host row.
  const other = await createEvent(second, "Move Target", "draft");
  await expectLastHostRejected(
    "update public.event_collaborators set event_id = $1 where event_id = $2 and profile_id = $3",
    [other.id, event.id, host.userId],
  );

  // Source kept its only host; the destination gained nothing.
  const source = await host.client.from("event_collaborators")
    .select("profile_id, role").eq("event_id", event.id);
  expect(source.error).toBeNull();
  expect(source.data).toHaveLength(1);
  expect(source.data![0].profile_id).toBe(host.userId);
  expect(source.data![0].role).toBe("host");
  const target = await second.client.from("event_collaborators")
    .select("profile_id").eq("event_id", other.id);
  expect(target.error).toBeNull();
  expect(target.data!.map((row) => row.profile_id)).not.toContain(host.userId);
});

test("reassigning the last host row to another profile is rejected", async () => {
  const event = await createEvent(host, "Reassign Target", "draft");
  await expectLastHostRejected(
    "update public.event_collaborators set profile_id = $1 where event_id = $2 and profile_id = $3",
    [second.userId, event.id, host.userId],
  );
});

test("a no-op host role update succeeds", async () => {
  const event = await createEvent(host, "No-op Role", "draft");
  const a = await admin();
  const updated = await a.query(
    "update public.event_collaborators set role = 'host' where event_id = $1 and profile_id = $2 returning role",
    [event.id, host.userId],
  );
  expect(updated.rows).toHaveLength(1);
  expect(updated.rows[0].role).toBe("host");
});

test("moving one of two hosts leaves the remaining host intact", async () => {
  const event = await createEvent(host, "Two Hosts Source", "draft");
  const other = await createEvent(host, "Two Hosts Target", "draft");
  const promoted = await host.client.from("event_collaborators").insert({
    event_id: event.id, profile_id: second.userId, role: "host",
  });
  expect(promoted.error).toBeNull();

  // The original event keeps a host, so moving the second host row is
  // a legal roster change — the guard is not a blanket move ban.
  const a = await admin();
  const moved = await a.query(
    "update public.event_collaborators set event_id = $1 where event_id = $2 and profile_id = $3 returning event_id",
    [other.id, event.id, second.userId],
  );
  expect(moved.rows).toHaveLength(1);

  const roster = await host.client.from("event_collaborators")
    .select("profile_id, role").eq("event_id", event.id);
  expect(roster.error).toBeNull();
  expect(roster.data).toHaveLength(1);
  expect(roster.data![0].profile_id).toBe(host.userId);
});

test("deleting the event still cascades its roster", async () => {
  const event = await createEvent(host, "Cascade Deletion", "draft");
  const promoted = await host.client.from("event_collaborators").insert({
    event_id: event.id, profile_id: second.userId, role: "host",
  });
  expect(promoted.error).toBeNull();

  // The guard protects living events: the FK cascade from the parent
  // deletion must pass through it untouched (tests/access scenario 11).
  const deleted = await host.client.from("events").delete().eq("id", event.id);
  expect(deleted.error).toBeNull();

  const a = await admin();
  const left = await a.query(
    "select count(*)::int as n from public.event_collaborators where event_id = $1",
    [event.id],
  );
  expect(left.rows[0].n).toBe(0);
});
