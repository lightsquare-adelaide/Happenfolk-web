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

// Red mode: drop the policy that lets hosts remove collaborators —
// the removal no-ops, the collaborator keeps access and the final
// "still forbidden" assertion below must FAIL.
guard(
  "04-hosts-remove-collaborators",
  `drop policy "hosts remove collaborators" on public.event_collaborators;`,
  `create policy "hosts remove collaborators" on public.event_collaborators
     for delete to authenticated
     using (public.is_event_host(event_id, auth.uid()));`,
);

let host: TestUser;
let collaborator: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  collaborator = await createUser("collab");
  event = await createEvent(host, "Pop-up Gallery");
  await addCollaborator(host, event.id, collaborator.userId);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 4 — collaborator removed, then tries to edit again", () => {
  it("denies edits after removal", async () => {
    // Sanity: while on the roster the collaborator can edit.
    const joined = await collaborator.client
      .from("events")
      .update({ title: "Co-edited Title" })
      .eq("id", event.id);
    expect(joined.error).toBeNull();
    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Co-edited Title",
    );

    // Host removes them.
    const removed = await host.client
      .from("event_collaborators")
      .delete()
      .eq("event_id", event.id)
      .eq("profile_id", collaborator.userId);
    expect(removed.error).toBeNull();

    // Removed collaborator edits again: 204, zero rows — data unchanged.
    const again = await collaborator.client
      .from("events")
      .update({ title: "Post-removal Title" })
      .eq("id", event.id);
    expect(again.error).toBeNull();
    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Co-edited Title",
    );
  });
});
