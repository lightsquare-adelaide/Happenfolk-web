import { afterAll, beforeAll, expect, test } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
} from "./_harness";

// Preserve the complete original view and its grants/dependencies. This
// red guard also works after discovery adds ranking columns to the view.
guard(
  "12-trending-includes-drafts",
  `alter view public.trending_events rename to zzz_red_12_original;
   create view public.trending_events as select id from public.events;
   grant select on public.trending_events to anon, authenticated;`,
  `drop view public.trending_events;
   alter view public.zzz_red_12_original rename to trending_events;`,
);

let undoRed: (() => Promise<void>) | null = null;
beforeAll(async () => { undoRed = await applyRedGuard(); });
afterAll(async () => { if (undoRed) await undoRed(); });

test("anonymous trending excludes draft events and retains published events", async () => {
  const host = await createUser("trending-host");

  const published = await createEvent(
    host,
    "Visible Published Event",
    "published",
  );

  const draft = await createEvent(
    host,
    "Hidden Draft Event",
    "draft",
  );

  const { data, error } = await anonClient()
    .from("trending_events")
    .select("id")
    .in("id", [published.id, draft.id]);

  expect(error).toBeNull();

  const visibleIds = (data ?? []).map((row) => row.id);

  expect(visibleIds).toContain(published.id);
  expect(visibleIds).not.toContain(draft.id);
});
