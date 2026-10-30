import { expect, test } from "vitest";
import { admin, createUser } from "../access/_harness";
import {
  createPricedEvent,
  orderCount,
  orderStatus,
  registrationStatus,
  seatCount,
} from "./_fixtures";

/**
 * Audit A8 (26 October 2026): settle_order never looked at the
 * registration, so a pending order belonging to a CANCELLED registration
 * settled to 'succeeded' — money taken for a seat that had already been
 * released — while the registration stayed 'cancelled' because 0008's
 * second UPDATE only matches ('pending','payment_failed'). Migration
 * 20261026000200 locks and checks the registration first and refuses the
 * charge. The order stays 'pending' on purpose: register_for_event revives
 * the cancelled registration and reuses that same order (0011's
 * one-open-order index), so the member pays exactly once and only while
 * holding a seat.
 *
 * Audit A9 (26 October 2026) is documented, not changed: a
 * 'payment_failed' registration keeps its seat until the member cancels or
 * pays. The second test pins that policy so changing it is a deliberate
 * act. It simulates the declined gateway with a direct status update
 * rather than by flipping payment_stub_settings, because that switch is
 * process-global and tests/payments/01 asserts it reads false while these
 * suites run in parallel.
 */

test("settling an order whose registration was cancelled is refused, then converges", async () => {
  const host = await createUser("settle-cancel-host");
  const member = await createUser("settle-cancel-member");
  const eventId = await createPricedEvent(host, "Pay After Cancelling", 2500, 5);

  const registration = await member.client.rpc("register_for_event", {
    p_event_id: eventId,
  });
  expect(registration.error).toBeNull();
  const registrationId = registration.data as string;

  const { data: order, error: orderError } = await member.client
    .from("orders")
    .select("id")
    .eq("registration_id", registrationId)
    .single();
  expect(orderError).toBeNull();
  const orderId = order?.id as string;

  const cancel = await member.client.rpc("cancel_registration", {
    p_registration_id: registrationId,
  });
  expect(cancel.error).toBeNull();

  // The defect: this used to return 'succeeded' and take the money.
  const refused = await member.client.rpc("settle_order", { p_order_id: orderId });
  expect(refused.error?.message).toContain("REGISTRATION_CANCELLED");
  expect(await orderStatus(orderId)).toBe("pending");
  expect(await registrationStatus(eventId, member.userId)).toBe("cancelled");
  expect(await seatCount(eventId)).toBe(0);

  // Registering again revives the same registration and reuses the same
  // open order — one seat, one ledger entry.
  const revived = await member.client.rpc("register_for_event", { p_event_id: eventId });
  expect(revived.error).toBeNull();
  expect(revived.data).toBe(registrationId);
  expect(await orderCount(eventId, member.userId)).toBe(1);

  const paid = await member.client.rpc("settle_order", { p_order_id: orderId });
  expect(paid.error).toBeNull();
  expect(paid.data).toBe("succeeded");
  expect(await orderStatus(orderId)).toBe("succeeded");
  expect(await registrationStatus(eventId, member.userId)).toBe("confirmed");
  expect(await seatCount(eventId)).toBe(1);
});

test("documented policy: a declined payment holds its seat until cancelled", async () => {
  const host = await createUser("declined-host");
  const declined = await createUser("declined-member");
  const next = await createUser("declined-next-member");
  const eventId = await createPricedEvent(host, "Single Seat Declined", 1000, 1);

  const registration = await declined.client.rpc("register_for_event", {
    p_event_id: eventId,
  });
  expect(registration.error).toBeNull();

  const a = await admin();
  await a.query(
    `update public.event_registrations set status = 'payment_failed'
      where event_id = $1 and member_id = $2`,
    [eventId, declined.userId],
  );
  await a.query(
    `update public.orders set status = 'failed'
      where registration_id = $1`,
    [registration.data as string],
  );

  // Existing stub-gateway behaviour, unchanged and now pinned: the seat is
  // still reserved, so the next member is turned away.
  expect(await seatCount(eventId)).toBe(1);
  const blocked = await next.client.rpc("register_for_event", { p_event_id: eventId });
  expect(blocked.error?.message).toContain("EVENT_FULL");

  // Cancelling releases the seat, which is the documented way out.
  const cancel = await declined.client.rpc("cancel_registration", {
    p_registration_id: registration.data,
  });
  expect(cancel.error).toBeNull();
  expect(await seatCount(eventId)).toBe(0);

  const taken = await next.client.rpc("register_for_event", { p_event_id: eventId });
  expect(taken.error).toBeNull();
  expect(await seatCount(eventId)).toBe(1);
  expect(await registrationStatus(eventId, next.userId)).toBe("pending");
});
