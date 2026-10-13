import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  readScalar,
  type EventRow,
  type TestUser,
} from "./_harness";

// Red mode: replace the collaborator-scoped update policy with an
// everyone-permissive one — the non-collaborator's patch now lands and
// the "unchanged" assertion below must FAIL.
guard(
  "02-events-update-permissive",
  `drop policy "collaborators update events" on public.events;
   create policy zzz_red_02_permissive on public.events for update to authenticated
     using (true) with check (true);`,
  `drop policy zzz_red_02_permissive on public.events;
   create policy "collaborators update events" on public.events for update to authenticated
     using (host_id = auth.uid() or public.is_event_collaborator(id, auth.uid()))
     with check (host_id = auth.uid() or public.is_event_collaborator(id, auth.uid()));`,
);

let host: TestUser;
let outsider: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  outsider = await createUser("outsider");
  event = await createEvent(host, "Members Only Night");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 2 — non-collaborator artist edits an event", () => {
  it("is silently filtered: data ends unchanged", async () => {
    // The 204 trap: RLS turns this into "success, zero rows".
    const { error } = await outsider.client
      .from("events")
      .update({ title: "Hijacked Title" })
      .eq("id", event.id);
    expect(error).toBeNull();

    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Members Only Night",
    );
  });
});
