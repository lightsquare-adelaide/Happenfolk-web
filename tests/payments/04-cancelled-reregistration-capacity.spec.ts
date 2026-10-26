import { expect, test } from "vitest";
import { createUser } from "../access/_harness";
import { createPricedEvent, registrationStatus, seatCount } from "./_fixtures";

/**
 * Audit A2 (26 October 2026): 0011's register_for_event checked capacity
 * only on the brand-new-registration branch. Reviving a CANCELLED
 * registration took a seat with no capacity check at all, so
 * "register, cancel, let somebody else take the last seat, register again"
 * oversold the event. The event row is already locked FOR UPDATE at that
 * point, so both branches can share one check and stay serialised.
 *
 * Migration 20261026000200 hoists the check above the insert/revive
 * branch. These two cases cover the free path (seat confirmed at
 * registration) and the paid path (seat reserved as pending).
 */

test("a cancelled member cannot revive their seat on an event that filled up (free)", async () => {
  const host = await createUser("revive-host-free");
  const leaver = await createUser("revive-leaver-free");
  const taker = await createUser("revive-taker-free");
  const eventId = await createPricedEvent(host, "One Seat Free Session", 0, 1);

  const first = await leaver.client.rpc("register_for_event", { p_event_id: eventId });
  expect(first.error).toBeNull();
  expect(await registrationStatus(eventId, leaver.userId)).toBe("confirmed");
  expect(await seatCount(eventId)).toBe(1);

  const cancel = await leaver.client.rpc("cancel_registration", {
    p_registration_id: first.data,
  });
  expect(cancel.error).toBeNull();
  expect(await seatCount(eventId)).toBe(0);

  const taken = await taker.client.rpc("register_for_event", { p_event_id: eventId });
  expect(taken.error).toBeNull();
  expect(await seatCount(eventId)).toBe(1);

  // The defect: this used to succeed and leave two seats on one seat.
  const revive = await leaver.client.rpc("register_for_event", { p_event_id: eventId });
  expect(revive.error?.message).toContain("EVENT_FULL");
  expect(await seatCount(eventId)).toBe(1);
  expect(await registrationStatus(eventId, leaver.userId)).toBe("cancelled");
  expect(await registrationStatus(eventId, taker.userId)).toBe("confirmed");
});

test("a cancelled member cannot revive their seat on an event that filled up (paid)", async () => {
  const host = await createUser("revive-host-paid");
  const leaver = await createUser("revive-leaver-paid");
  const taker = await createUser("revive-taker-paid");
  const eventId = await createPricedEvent(host, "One Seat Paid Show", 2500, 1);

  const first = await leaver.client.rpc("register_for_event", { p_event_id: eventId });
  expect(first.error).toBeNull();
  expect(await registrationStatus(eventId, leaver.userId)).toBe("pending");

  const cancel = await leaver.client.rpc("cancel_registration", {
    p_registration_id: first.data,
  });
  expect(cancel.error).toBeNull();

  const taken = await taker.client.rpc("register_for_event", { p_event_id: eventId });
  expect(taken.error).toBeNull();
  expect(await seatCount(eventId)).toBe(1);

  const revive = await leaver.client.rpc("register_for_event", { p_event_id: eventId });
  expect(revive.error?.message).toContain("EVENT_FULL");
  expect(await seatCount(eventId)).toBe(1);
  expect(await registrationStatus(eventId, leaver.userId)).toBe("cancelled");
});

test("reviving a cancelled seat still works while the event has room", async () => {
  const host = await createUser("revive-host-room");
  const member = await createUser("revive-member-room");
  const eventId = await createPricedEvent(host, "Roomy Free Session", 0, 3);

  const first = await member.client.rpc("register_for_event", { p_event_id: eventId });
  expect(first.error).toBeNull();
  await member.client.rpc("cancel_registration", { p_registration_id: first.data });
  expect(await seatCount(eventId)).toBe(0);

  const revived = await member.client.rpc("register_for_event", { p_event_id: eventId });
  expect(revived.error).toBeNull();
  // The unique (event_id, member_id) pair means the same row is revived,
  // not a second registration.
  expect(revived.data).toBe(first.data);
  expect(await seatCount(eventId)).toBe(1);
  expect(await registrationStatus(eventId, member.userId)).toBe("confirmed");
});
