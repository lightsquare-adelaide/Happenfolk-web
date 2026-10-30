import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  readScalar,
  type EventRow,
  type TestUser,
} from "./_harness";

// Red mode removes both independent protections for this title update:
// the deny-by-default policy and the absence of anonymous UPDATE grants.
// The patch must then land, making the unchanged-data assertion fail.
guard(
  "03-anon-update-permissive",
  `grant update (title) on public.events to anon;
   create policy zzz_red_03_anon_update on public.events for update
     using (true) with check (true);`,
  `drop policy zzz_red_03_anon_update on public.events;
   revoke update (title) on public.events from anon;`,
);

let host: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  event = await createEvent(host, "Open Studios");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 3 — anonymous visitor edits an event", () => {
  it("keeps the event unchanged", async () => {
    const { error } = await anonClient()
      .from("events")
      .update({ title: "Vandalised" })
      .eq("id", event.id);
    // Either RLS filters zero rows or least-privilege grants deny the verb.
    if (error) expect(error.code).toBe("42501");

    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Open Studios",
    );
  });
});
