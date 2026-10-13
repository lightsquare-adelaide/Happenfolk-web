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

guard(
  "01-collaborator-update-policy",
  `drop policy "collaborators update events" on public.events;`,
  `create policy "collaborators update events" on public.events for update to authenticated
     using (host_id = auth.uid() or public.is_event_collaborator(id, auth.uid()))
     with check (host_id = auth.uid() or public.is_event_collaborator(id, auth.uid()));`,
);

let host: TestUser;
let collaborator: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  collaborator = await createUser("collab");
  event = await createEvent(host, "Joint Exhibition");
  await addCollaborator(host, event.id, collaborator.userId);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 1 — named collaborator edits an event they did not create", () => {
  it("the collaborator's rename lands", async () => {
    const { error } = await collaborator.client
      .from("events")
      .update({ title: "Renamed by collaborator" })
      .eq("id", event.id);
    expect(error).toBeNull();
    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Renamed by collaborator",
    );
  });
});
