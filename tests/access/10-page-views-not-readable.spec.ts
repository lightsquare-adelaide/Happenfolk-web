import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  type EventRow,
  type TestUser,
} from "./_harness";

// Red mode: a permissive select policy on page_views — raw visitor
// rows become readable and the "zero rows" assertions must FAIL.
guard(
  "10-page-views-select-permissive",
  `create policy zzz_red_10_leak on public.page_views for select using (true);`,
  `drop policy zzz_red_10_leak on public.page_views;`,
);

let host: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  event = await createEvent(host, "Analytics Awareness");
  // Guarantee at least one raw row exists before asserting it is
  // unreadable through any client.
  const rpc = await anonClient().rpc("record_page_view", {
    p_subject_type: "event",
    p_subject_id: event.id,
  });
  expect(rpc.error).toBeNull();
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 10 — direct page_views queries return zero rows", () => {
  it("denies anon and authenticated alike", async () => {
    const member = await createUser("member");

    for (const client of [anonClient(), member.client]) {
      const rows = await client.from("page_views").select("id, subject_id");
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(0);
    }
  });
});
