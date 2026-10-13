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

// Red mode: revoke the recorder's execute grant — including from
// PUBLIC, which grants EXECUTE on functions by default and would
// otherwise silently re-arm anon. The RPC must then error, making the
// "count +1" assertion FAIL.
guard(
  "09-record-page-view-revoke-anon",
  `revoke execute on function public.record_page_view(text, uuid) from anon, public;`,
  `grant execute on function public.record_page_view(text, uuid) to public;
   grant execute on function public.record_page_view(text, uuid) to anon, authenticated;`,
);

let host: TestUser;
let event: EventRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("host");
  event = await createEvent(host, "Count Me Event");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 9 — anonymous visitor calls record_page_view", () => {
  it("succeeds and bumps the trending count", async () => {
    const before = await anonClient()
      .from("trending_events")
      .select("view_count")
      .eq("id", event.id)
      .single();
    expect(before.error).toBeNull();

    const rpc = await anonClient().rpc("record_page_view", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(rpc.error).toBeNull();

    const after = await anonClient()
      .from("trending_events")
      .select("view_count")
      .eq("id", event.id)
      .single();
    expect(after.error).toBeNull();
    expect(Number(after.data?.view_count)).toBe(
      Number(before.data?.view_count) + 1,
    );
  });
});
