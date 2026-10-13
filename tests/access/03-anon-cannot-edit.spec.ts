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

// Red mode: an update policy that also covers anon — the anonymous
// patch lands and the "unchanged" assertion below must FAIL.
guard(
  "03-anon-update-permissive",
  `create policy zzz_red_03_anon_update on public.events for update
     using (true) with check (true);`,
  `drop policy zzz_red_03_anon_update on public.events;`,
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
  it("is silently filtered: data ends unchanged", async () => {
    const { error } = await anonClient()
      .from("events")
      .update({ title: "Vandalised" })
      .eq("id", event.id);
    expect(error).toBeNull(); // 204, zero rows — check the data, not the code

    expect(await readScalar(host.client, "events", event.id, "title")).toBe(
      "Open Studios",
    );
  });
});
