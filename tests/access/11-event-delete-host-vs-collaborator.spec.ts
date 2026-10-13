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

// Red mode 11a: drop the host-delete policy — the creator's own delete
// no-ops and the "gone" assertion must FAIL.
guard(
  "11a-hosts-delete-dropped",
  `drop policy "hosts delete own events" on public.events;`,
  `create policy "hosts delete own events" on public.events
     for delete to authenticated using (host_id = auth.uid());`,
);

// Red mode 11b: an everyone-permissive delete policy — the
// collaborator's delete lands and the "still there" assertion must FAIL.
guard(
  "11b-events-delete-permissive",
  `drop policy "hosts delete own events" on public.events;
   create policy zzz_red_11b_delete on public.events for delete to authenticated using (true);`,
  `drop policy zzz_red_11b_delete on public.events;
   create policy "hosts delete own events" on public.events
     for delete to authenticated using (host_id = auth.uid());`,
);

let host: TestUser;
let collaborator: TestUser;
let ownEvent: EventRow;
let sharedEvent: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  collaborator = await createUser("collab");
  ownEvent = await createEvent(host, "Host's Solo Event");
  sharedEvent = await createEvent(host, "Host's Shared Event");
  await addCollaborator(host, sharedEvent.id, collaborator.userId);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 11 — deleting events: creator vs collaborator", () => {
  it("the creator can delete their own event", async () => {
    const { error } = await host.client.from("events").delete().eq("id", ownEvent.id);
    expect(error).toBeNull();
    expect(await readScalar(host.client, "events", ownEvent.id, "title")).toBe(
      "MISSING_ROW",
    );
  });

  it("a collaborator cannot delete the host's event", async () => {
    const { error } = await collaborator.client
      .from("events")
      .delete()
      .eq("id", sharedEvent.id);
    expect(error).toBeNull(); // 204, zero rows

    expect(await readScalar(host.client, "events", sharedEvent.id, "title")).toBe(
      "Host's Shared Event",
    );
  });
});
