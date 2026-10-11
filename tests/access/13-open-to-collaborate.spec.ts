import { expect, test } from "vitest";
import {
  addCollaborator,
  anonClient,
  createEvent,
  createUser,
} from "./_harness";

test("open-to-collaborate uses the default, team permissions, and published-only filtering", async () => {
  const host = await createUser("collab-host");
  const collaborator = await createUser("collab-member");
  const stranger = await createUser("collab-stranger");

  const publishedEvent = await createEvent(
    host,
    "Collaboration Test Event",
    "published",
  );

  const initial = await host.client
    .from("events")
    .select("open_to_collaborate")
    .eq("id", publishedEvent.id)
    .single();

  expect(initial.error).toBeNull();
  expect(initial.data?.open_to_collaborate).toBe(false);

  const hostUpdate = await host.client
    .from("events")
    .update({ open_to_collaborate: true })
    .eq("id", publishedEvent.id)
    .select("id")
    .single();

  expect(hostUpdate.error).toBeNull();

  await addCollaborator(host, publishedEvent.id, collaborator.userId);

  const collaboratorUpdate = await collaborator.client
    .from("events")
    .update({ open_to_collaborate: false })
    .eq("id", publishedEvent.id)
    .select("id")
    .single();

  expect(collaboratorUpdate.error).toBeNull();

  const strangerUpdate = await stranger.client
    .from("events")
    .update({ open_to_collaborate: true })
    .eq("id", publishedEvent.id)
    .select("id");

  expect(strangerUpdate.error).toBeNull();
  expect(strangerUpdate.data).toEqual([]);

  const draftEvent = await createEvent(
    host,
    "Draft Collaboration Test Event",
    "draft",
  );

  const enableDraft = await host.client
    .from("events")
    .update({ open_to_collaborate: true })
    .eq("id", draftEvent.id);

  expect(enableDraft.error).toBeNull();

  const reopen = await host.client
    .from("events")
    .update({ open_to_collaborate: true })
    .eq("id", publishedEvent.id)
    .select("id")
    .single();

  expect(reopen.error).toBeNull();

  const { data, error } = await anonClient()
    .from("events")
    .select("id")
    .eq("status", "published")
    .eq("open_to_collaborate", true)
    .in("id", [publishedEvent.id, draftEvent.id]);

  expect(error).toBeNull();
  expect((data ?? []).map((event) => event.id)).toEqual([publishedEvent.id]);
});