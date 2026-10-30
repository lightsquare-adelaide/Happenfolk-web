import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  applyRedGuard,
  countOccupying,
  createUser,
  loadFixtures,
  resetGatewaySwitch,
  restoreFunctionGrants,
  runId,
} from "./_harness";

/**
 * Paid-order lifecycle (BUILD_PLAN P1 scenarios 13-17, 19) through the
 * real 0008 RPCs and RLS. The 204 trap from the brief: over-RLS a
 * denied write looks like success with zero rows — so every denial is
 * asserted by DATA STATE read back through the admin connection
 * (fixtures only), never by trusting an error-shaped status.
 */

let restore: (() => Promise<void>) | null = null;

beforeAll(async () => {
  restore = await applyRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
  await restoreFunctionGrants();
  await resetGatewaySwitch();
});

describe("P7 — scenario 13: paid + gateway success", () => {
  it("creates a pending order, settles it, confirms, occupies one seat", async () => {
    const { members, paidEventId } = await loadFixtures();
    const member = members[2];
    const a = await admin();

    const { data: registrationId, error } = await member.client.rpc("register_for_event", {
      p_event_id: paidEventId,
    });
    expect(error).toBeNull();
    expect(await countOccupying(a, paidEventId)).toBe(1); // pending already occupies

    const { data: orders } = await member.client
      .from("orders")
      .select("id, status, amount_cents")
      .eq("registration_id", registrationId);
    expect(orders ?? []).toHaveLength(1);
    expect(orders?.[0]?.status).toBe("pending");
    expect(orders?.[0]?.amount_cents).toBe(2500);

    const { data: settled, error: settleError } = await member.client.rpc("settle_order", {
      p_order_id: orders?.[0]?.id,
      p_force_fail: false,
    });
    expect(settleError).toBeNull();
    expect(settled).toBe("succeeded");

    const { data: reg } = await member.client
      .from("event_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    expect(reg?.status).toBe("confirmed");
    expect(await countOccupying(a, paidEventId)).toBe(1); // still exactly one seat
  });
});

describe("P7 — scenario 14: paid + failure, retry, both orders stay", () => {
  it("keeps the failed order in history and confirms only after a new order", async () => {
    const { members, paidEventId } = await loadFixtures();
    const member = members[3];

    const { data: registrationId, error } = await member.client.rpc("register_for_event", {
      p_event_id: paidEventId,
    });
    expect(error).toBeNull();

    // Gateway round 1: fail — chosen per-settle (0024), no global switch.
    const { data: firstOrders } = await member.client
      .from("orders")
      .select("id")
      .eq("registration_id", registrationId)
      .eq("status", "pending");
    const firstOrderId = firstOrders?.[0]?.id;
    const { data: failed } = await member.client.rpc("settle_order", {
      p_order_id: firstOrderId,
      p_force_fail: true,
    });
    expect(failed).toBe("failed");

    const { data: regAfterFail } = await member.client
      .from("event_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    expect(regAfterFail?.status).toBe("payment_failed");

    // Retry: register again -> NEW order against the SAME registration.
    const { data: retryId, error: retryError } = await member.client.rpc("register_for_event", {
      p_event_id: paidEventId,
    });
    expect(retryError).toBeNull();
    expect(retryId).toBe(registrationId);

    const { data: history } = await member.client
      .from("orders")
      .select("id, status")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: true });
    expect(history ?? []).toHaveLength(2);
    expect(history?.[0]?.status).toBe("failed"); // never deleted or rewritten
    expect(history?.[1]?.status).toBe("pending");

    // Gateway round 2: succeed.
    const { data: succeeded } = await member.client.rpc("settle_order", {
      p_order_id: history?.[1]?.id,
      p_force_fail: false,
    });
    expect(succeeded).toBe("succeeded");

    const { data: regFinal } = await member.client
      .from("event_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    expect(regFinal?.status).toBe("confirmed");

    // Exactly ONE registration for this member despite two orders.
    const { data: allRegs } = await member.client
      .from("event_registrations")
      .select("id")
      .eq("event_id", paidEventId)
      .eq("member_id", member.userId);
    expect(allRegs ?? []).toHaveLength(1);
  });
});

describe("P7 — scenario 15: settling twice is an idempotent no-op", () => {
  it("returns the current status and changes nothing on the second call", async () => {
    const { members, paidEventId } = await loadFixtures();
    const member = members[0];
    const a = await admin();

    const { data: registrationId } = await member.client.rpc("register_for_event", {
      p_event_id: paidEventId,
    });
    const { data: orders } = await member.client
      .from("orders")
      .select("id")
      .eq("registration_id", registrationId)
      .eq("status", "pending");
    const orderId = orders?.[0]?.id;

    const { data: first } = await member.client.rpc("settle_order", {
      p_order_id: orderId,
      p_force_fail: false,
    });
    expect(first).toBe("succeeded");

    const orderCountBefore = await a.query<{ count: string }>(
      "select count(*)::text as count from public.orders where registration_id = $1",
      [registrationId],
    );
    const { data: second } = await member.client.rpc("settle_order", { p_order_id: orderId });
    expect(second).toBe("succeeded"); // no-op returning current status
    const orderCountAfter = await a.query<{ count: string }>(
      "select count(*)::text as count from public.orders where registration_id = $1",
      [registrationId],
    );
    expect(orderCountAfter.rows[0]?.count).toBe(orderCountBefore.rows[0]?.count);

    // The stronger idempotency proof: settle the SAME order again, now
    // choosing force-fail as the per-settle outcome (0024). A no-op
    // must return the current status ('succeeded'); a non-idempotent
    // settle would re-run the gateway and REWRITE the outcome to
    // 'failed'. Data state decides (204-trap discipline).
    const { data: third } = await member.client.rpc("settle_order", {
      p_order_id: orderId,
      p_force_fail: true,
    });
    expect(third).toBe("succeeded");

    const orderCheck = await a.query<{ status: string }>(
      "select status from public.orders where id = $1",
      [orderId],
    );
    expect(orderCheck.rows[0]?.status).toBe("succeeded");

    const { data: reg } = await member.client
      .from("event_registrations")
      .select("status")
      .eq("id", registrationId)
      .maybeSingle();
    expect(reg?.status).toBe("confirmed");
  });
});

describe("P7 — scenario 16: settling someone else's order is rejected", () => {
  it("tells B ORDER_NOT_FOUND_OR_NOT_YOURS and leaves A's order untouched", async () => {
    const { members, paidEventId } = await loadFixtures();
    const owner = members[1];
    const attacker = members[2];
    const a = await admin();

    const { data: registrationId } = await owner.client.rpc("register_for_event", {
      p_event_id: paidEventId,
    });
    const { data: orders } = await owner.client
      .from("orders")
      .select("id, status")
      .eq("registration_id", registrationId)
      .eq("status", "pending");

    const { error } = await attacker.client.rpc("settle_order", { p_order_id: orders?.[0]?.id });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("ORDER_NOT_FOUND_OR_NOT_YOURS");

    // Data state: still pending, attacker gained nothing.
    const check = await a.query<{ status: string }>(
      "select status from public.orders where id = $1",
      [orders?.[0]?.id],
    );
    expect(check.rows[0]?.status).toBe("pending");
  });
});

describe("P7 — scenario 17: direct table writes are denied by RLS", () => {
  it("blocks insert and update on event_registrations and orders; data unchanged", async () => {
    const { members, paidEventId } = await loadFixtures();
    const member = members[4];
    const a = await admin();

    const regsBefore = await a.query<{ count: string }>(
      "select count(*)::text as count from public.event_registrations where member_id = $1",
      [member.userId],
    );
    const ordersBefore = await a.query<{ count: string }>(
      "select count(*)::text as count from public.orders where member_id = $1",
      [member.userId],
    );

    const insertReg = await member.client.from("event_registrations").insert({
      event_id: paidEventId,
      member_id: member.userId,
      status: "confirmed",
    });
    expect(insertReg.error).not.toBeNull();

    const insertOrder = await member.client.from("orders").insert({
      registration_id: "00000000-0000-0000-0000-000000000000",
      member_id: member.userId,
      amount_cents: 100,
      status: "succeeded",
    });
    expect(insertOrder.error).not.toBeNull();

    const regsAfter = await a.query<{ count: string }>(
      "select count(*)::text as count from public.event_registrations where member_id = $1",
      [member.userId],
    );
    const ordersAfter = await a.query<{ count: string }>(
      "select count(*)::text as count from public.orders where member_id = $1",
      [member.userId],
    );
    expect(regsAfter.rows[0]?.count).toBe(regsBefore.rows[0]?.count);
    expect(ordersAfter.rows[0]?.count).toBe(ordersBefore.rows[0]?.count);

    // The member HAS a confirmed registration of their own (fixtures) —
    // try to rewrite its status directly. Read back the terminal state.
    const { data: ownReg } = await member.client
      .from("event_registrations")
      .select("id, status")
      .eq("member_id", member.userId)
      .limit(1)
      .maybeSingle();
    if (ownReg) {
      await member.client.from("event_registrations").update({ status: "cancelled" }).eq("id", ownReg.id);
      const check = await a.query<{ status: string }>(
        "select status from public.event_registrations where id = $1",
        [ownReg.id],
      );
      expect(check.rows[0]?.status).toBe(ownReg.status);
    }
  });
});

describe("P7 — scenario 19: read scope — own rows, team rows, nothing else", () => {
  it("hides others' registrations; collaborators see only their event", async () => {
    const { members, freeEventId, paidEventId } = await loadFixtures();
    const outsider = members[4];
    const collaborator = await createUser("collab");
    const a = await admin();

    // Publish the collaborator and put them on the FREE event's team
    // only. A fresh member keeps this test independent of the earlier
    // scenarios' own rows.
    const { error: publishError } = await collaborator.client
      .from("profiles")
      .update({ published: true, category_id: 4 })
      .eq("id", collaborator.userId);
    expect(publishError).toBeNull();
    await a.query(
      "insert into public.event_collaborators (event_id, profile_id, role) values ($1, $2, 'collaborator') on conflict do nothing",
      [freeEventId, collaborator.userId],
    );

    // A fan registers on the free event: the collaborator (event team)
    // must see that row.
    const { data: fanRegId, error: fanError } = await outsider.client.rpc("register_for_event", {
      p_event_id: freeEventId,
    });
    expect(fanError).toBeNull();

    // outsider reads someone else's registrations: zero rows (they are
    // not on the free event's team).
    const { data: seenByOutsider } = await outsider.client
      .from("event_registrations")
      .select("id")
      .eq("member_id", members[0].userId);
    expect(seenByOutsider ?? []).toHaveLength(0);

    const { data: visible } = await collaborator.client
      .from("event_registrations")
      .select("id, event_id, member_id");
    const eventIds = new Set((visible ?? []).map((r) => r.event_id));
    expect(visible?.some((r) => r.id === fanRegId)).toBe(true); // team row visible
    expect(eventIds.has(paidEventId)).toBe(false); // no team membership there
  });
});

describe("P7 — scenario 24 (0024): concurrent settles choose outcomes independently", () => {
  it("two members settle at once, one succeeds one fails, results never cross", async () => {
    const { host } = await loadFixtures();
    const a = await admin();
    const alpha = await createUser("alpha");
    const beta = await createUser("beta");

    // Fresh paid event so capacity bookkeeping from earlier scenarios
    // cannot interfere.
    const { data: eventId, error: eventError } = await host.client
      .from("events")
      .insert({
        host_id: host.userId,
        category_id: 4,
        title: `Concurrent Settle Event ${runId}`,
        description: "per-settle outcome independence",
        status: "published",
        price_cents: 1500,
        capacity: 10,
        starts_at: new Date(Date.now() + 96 * 3600 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 99 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();
    expect(eventError).toBeNull();
    const evId = eventId?.id as string;

    const { data: alphaRegId } = await alpha.client.rpc("register_for_event", {
      p_event_id: evId,
    });
    const { data: betaRegId } = await beta.client.rpc("register_for_event", {
      p_event_id: evId,
    });
    expect(await countOccupying(a, evId)).toBe(2);

    const pendingOrderIdFor = async (
      client: typeof alpha.client,
      regId: string | null,
    ): Promise<string> => {
      const { data: rows } = await client
        .from("orders")
        .select("id")
        .eq("registration_id", regId)
        .eq("status", "pending");
      return rows?.[0]?.id as string;
    };
    // Own-rows RLS: each member reads their own pending order id.
    const [alphaOrderId, betaOrderId] = await Promise.all([
      pendingOrderIdFor(alpha.client, alphaRegId),
      pendingOrderIdFor(beta.client, betaRegId),
    ]);

    // Simultaneous settle: alpha picks success, beta picks failure.
    // The pre-0024 global switch made this race site-wide: whoever
    // flipped last dictated BOTH outcomes.
    const [alphaRes, betaRes] = await Promise.allSettled([
      alpha.client.rpc("settle_order", { p_order_id: alphaOrderId, p_force_fail: false }),
      beta.client.rpc("settle_order", { p_order_id: betaOrderId, p_force_fail: true }),
    ]);
    expect(alphaRes.status).toBe("fulfilled");
    expect(betaRes.status).toBe("fulfilled");
    if (alphaRes.status === "fulfilled") {
      expect(alphaRes.value.error).toBeNull();
      expect(alphaRes.value.data).toBe("succeeded");
    }
    if (betaRes.status === "fulfilled") {
      expect(betaRes.value.error).toBeNull();
      expect(betaRes.value.data).toBe("failed");
    }

    // Data state: each order/registration landed in ITS OWN outcome.
    const statuses = await a.query<{ member_id: string; order: string; reg: string }>(
      `select o.member_id, o.status as order, r.status as reg
       from public.orders o
       join public.event_registrations r on r.id = o.registration_id
       where o.registration_id in ($1, $2)`,
      [alphaRegId, betaRegId],
    );
    const byMember = new Map(statuses.rows.map((r) => [r.member_id, r]));
    expect(byMember.get(alpha.userId)?.order).toBe("succeeded");
    expect(byMember.get(alpha.userId)?.reg).toBe("confirmed");
    expect(byMember.get(beta.userId)?.order).toBe("failed");
    expect(byMember.get(beta.userId)?.reg).toBe("payment_failed");
  });
});
