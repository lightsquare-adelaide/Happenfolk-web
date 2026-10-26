import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addCollaborator,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  readScalar,
  type EventRow,
  type TestUser,
} from "./_harness";

/**
 * Audit A1 (26 October 2026). "collaborators update events" (0007) decides
 * WHO may update an event row; a row-level policy cannot say WHICH columns.
 * A collaborator could therefore set host_id to their own id: WITH CHECK
 * passed on the row they had just read, and the update handed them the
 * host-only powers — "hosts delete own events" and the collaborator-roster
 * policies. Scenario 11 only covered a collaborator's direct delete, so the
 * bypass was unguarded.
 *
 * Migration 20261026000100 closes it twice over: a BEFORE UPDATE trigger
 * that rejects any host_id change, and column-level UPDATE privileges that
 * omit host_id. One guard removes BOTH layers, because breaking only one
 * leaves the other refusing the takeover and the file would still pass —
 * which proves nothing about this test's ability to see red.
 */
guard(
  "23-host-takeover-layers-removed",
  `drop trigger trg_events_host_id_immutable on public.events;
   grant update on public.events to authenticated;`,
  `revoke update on public.events from authenticated;
   grant update (
     category_id, title, description, status, starts_at, ends_at,
     price_cents, capacity, cover_path, search_vector, updated_at
   ) on public.events to authenticated;
   create trigger trg_events_host_id_immutable
     before update of host_id on public.events
     for each row execute function public.events_host_id_immutable ();`,
);

let host: TestUser;
let collaborator: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("audit-a1-host");
  collaborator = await createUser("audit-a1-collab");
  event = await createEvent(host, "Joint Festival");
  await addCollaborator(host, event.id, collaborator.userId);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("audit A1 — a collaborator cannot take over event ownership", () => {
  it("still lets a collaborator edit the ordinary columns", async () => {
    const { error } = await collaborator.client
      .from("events")
      .update({ title: "Joint Festival (edited by collaborator)" })
      .eq("id", event.id);
    expect(error).toBeNull();
    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Joint Festival (edited by collaborator)",
    );
  });

  it("refuses a host_id rewrite instead of silently ignoring it", async () => {
    const { error } = await collaborator.client
      .from("events")
      .update({ host_id: collaborator.userId })
      .eq("id", event.id);

    // Column privilege (42501) or the trigger, whichever layer is reached
    // first. Either way this is a loud refusal, not RLS's "204, zero rows".
    expect(error).not.toBeNull();
    expect(await readScalar(host.client, "events", event.id, "host_id")).toBe(
      host.userId,
    );
  });

  it("leaves the host-only powers with the creator", async () => {
    // The payoff of a successful takeover would be these two.
    const collabDelete = await collaborator.client
      .from("events")
      .delete()
      .eq("id", event.id);
    expect(collabDelete.error).toBeNull(); // 204, zero rows under RLS
    expect(await readScalar(host.client, "events", event.id, "title")).not.toBe(
      "MISSING_ROW",
    );

    const hostDelete = await host.client.from("events").delete().eq("id", event.id);
    expect(hostDelete.error).toBeNull();
    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "MISSING_ROW",
    );
  });
});
