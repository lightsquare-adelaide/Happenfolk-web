import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  type EventRow,
  type TestUser,
} from "./_harness";

// Red mode: drop the trigger — a freshly created event has no
// collaborator rows and the "at least one" assertion must FAIL.
guard(
  "05-host-collaborator-trigger",
  `drop trigger trg_events_add_host_collaborator on public.events;`,
  `create trigger trg_events_add_host_collaborator
     after insert on public.events
     for each row execute function public.events_add_host_collaborator();`,
);

let host: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  // The event is created AFTER the guard applies so the red run really
  // exercises an insert without the trigger.
  event = await createEvent(host, "Trigger Invariant Show");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 5 — a created event always has at least one collaborator", () => {
  it("the creator is on the roster as host", async () => {
    const { data, error } = await host.client
      .from("event_collaborators")
      .select("profile_id, role")
      .eq("event_id", event.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      profile_id: host.userId,
      role: "host",
    });
  });
});
