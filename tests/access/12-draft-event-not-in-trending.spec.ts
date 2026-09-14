import { expect, test } from "vitest";
import {
  anonClient,
  createEvent,
  createUser,
} from "./_harness";

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