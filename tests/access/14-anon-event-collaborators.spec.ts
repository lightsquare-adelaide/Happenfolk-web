import { expect, test } from "vitest";
import {
  addCollaborator,
  anonClient,
  createEvent,
  createUser,
} from "./_harness";

test("anonymous visitors see collaborators only on published events", async () => {
  const host = await createUser("public-collab-host");
  const collaborator = await createUser("public-collab-member");

  const published = await createEvent(host, "Public roster", "published");
  const draft = await createEvent(host, "Private roster", "draft");

  await addCollaborator(host, published.id, collaborator.userId);
  await addCollaborator(host, draft.id, collaborator.userId);

  const { data, error } = await anonClient()
    .from("event_collaborators")
    .select("event_id, profile_id")
    .eq("profile_id", collaborator.userId)
    .in("event_id", [published.id, draft.id]);

  expect(error).toBeNull();
  expect(data).toEqual([
    {
      event_id: published.id,
      profile_id: collaborator.userId,
    },
  ]);
});