import { expect, test } from "vitest";
import { createEvent, createUser } from "../access/_harness";

test("Tingxuan: free RSVP confirms, is idempotent, private, cancellable, and can be revived safely", async () => {
  const organizer = await createUser("tingxuan-rsvp-host");
  const member = await createUser("tingxuan-rsvp-member");
  const outsider = await createUser("tingxuan-rsvp-outsider");
  const event = await createEvent(organizer, "Tingxuan free registration verification", "published");

  const first = await member.client.rpc("register_for_event", { p_event_id: event.id });
  expect(first.error).toBeNull();
  expect(first.data).toBeTruthy();

  const second = await member.client.rpc("register_for_event", { p_event_id: event.id });
  expect(second.error).toBeNull();
  expect(second.data).toBe(first.data);

  const own = await member.client.from("event_registrations")
    .select("id, status").eq("id", first.data).single();
  expect(own.error).toBeNull();
  expect(own.data?.status).toBe("confirmed");

  const otherRead = await outsider.client.from("event_registrations")
    .select("id").eq("id", first.data);
  expect(otherRead.error).toBeNull();
  expect(otherRead.data).toEqual([]);

  const otherCancel = await outsider.client.rpc("cancel_registration", { p_registration_id: first.data });
  expect(otherCancel.error).not.toBeNull();

  const cancel = await member.client.rpc("cancel_registration", { p_registration_id: first.data });
  expect(cancel.error).toBeNull();
  const cancelled = await member.client.from("event_registrations")
    .select("status").eq("id", first.data).single();
  expect(cancelled.data?.status).toBe("cancelled");

  // The post-audit RPC guards seat capacity on this branch too.
  const revived = await member.client.rpc("register_for_event", { p_event_id: event.id });
  expect(revived.error).toBeNull();
  expect(revived.data).toBe(first.data);
  const confirmedAgain = await member.client.from("event_registrations")
    .select("status").eq("id", first.data).single();
  expect(confirmedAgain.data?.status).toBe("confirmed");
});
