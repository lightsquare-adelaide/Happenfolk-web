import pg from "pg";
import { stackConfig, anonClient, admin } from "../access/_harness";
import {
  appBase,
  startApp,
  closeApp,
  createUser,
  sessionCookieHeader,
} from "../media/_harness";
import type { TestUser } from "../media/_harness";

/**
 * Harness for the P7 payments tests.
 *
 * Ground rules (from the brief):
 * - Real local stack, no mocks. Per-user clients exercise RLS for
 *   every assertion; the admin pg connection exists for FIXTURES and
 *   the red-guard flips only.
 * - orders / event_registrations have NO write policies by design;
 *   everything flows through the 0008/0021 SECURITY DEFINER RPCs.
 * - Red-green: PAYMENTS_RED=lock (drop the for update) or
 *   PAYMENTS_RED=idempotency (drop settle_order's settled-check) must
 *   flip the corresponding specs red; without the env everything is
 *   green.
 */

export { appBase, startApp, closeApp, createUser, sessionCookieHeader, anonClient, admin, stackConfig };
export type { TestUser };

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type PaymentsFixtures = {
  host: TestUser;
  members: TestUser[]; // 5 distinct members for the concurrency race
  freeEventId: string; // price 0, capacity 10
  paidEventId: string; // price 2500, capacity 5
  capacityEventId: string; // price 0, capacity 2 — the 20-round race
};

let fixtures: PaymentsFixtures | null = null;

export async function loadFixtures(): Promise<PaymentsFixtures> {
  if (fixtures) return fixtures;

  const host = await createUser("host");
  const members = [
    await createUser("m1"),
    await createUser("m2"),
    await createUser("m3"),
    await createUser("m4"),
    await createUser("m5"),
  ];

  // Publish everyone (own-row RLS update; the onboarding trigger made
  // the profile rows at signup).
  for (const [i, u] of [host, ...members].entries()) {
    const { error } = await u.client
      .from("profiles")
      .update({ display_name: `Payments User ${runId} ${i}`, published: true, category_id: 4 })
      .eq("id", u.userId);
    if (error) throw new Error(`profile publish failed: ${error.message}`);
  }

  async function createEvent(
    creator: TestUser,
    title: string,
    priceCents: number,
    capacity: number | null,
  ): Promise<string> {
    const { data, error } = await creator.client
      .from("events")
      .insert({
        host_id: creator.userId,
        category_id: 4,
        title,
        description: `${title} description`,
        status: "published",
        price_cents: priceCents,
        capacity,
        starts_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 75 * 3600 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`event fixture failed: ${error?.message}`);
    return data.id;
  }

  const freeEventId = await createEvent(host, `Free Event ${runId}`, 0, 10);
  const paidEventId = await createEvent(host, `Paid Event ${runId}`, 2500, 5);
  const capacityEventId = await createEvent(host, `Capacity Event ${runId}`, 0, 2);

  fixtures = { host, members, freeEventId, paidEventId, capacityEventId };
  return fixtures;
}

/** Wipe this round's registrations so the race restarts from zero seats. */
export async function resetCapacityEvent(a: pg.Client, eventId: string): Promise<void> {
  await a.query("delete from public.event_registrations where event_id = $1", [eventId]);
}

/** Count registrations in occupying states (pending/confirmed/payment_failed). */
export async function countOccupying(a: pg.Client, eventId: string): Promise<number> {
  const res = await a.query<{ count: string }>(
    `select count(*)::text as count from public.event_registrations
     where event_id = $1 and status in ('pending', 'confirmed', 'payment_failed')`,
    [eventId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

/**
 * Reset the stub gateway switch so tests never leak state to each other.
 * Since 0024 the switch is service_role-only (it is a CI fixture knob,
 * no client can reach it), so this goes through the admin connection.
 */
export async function resetGatewaySwitch(): Promise<void> {
  const a = await admin();
  await a.query("update public.payment_stub_settings set force_fail = false where id = true");
}

// ---------------- red guards (PAYMENTS_RED=<name>) ----------------

type Guard = { name: string; breakSql: string };

const UNLOCKED_REGISTER = `
create or replace function public.register_for_event (p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_event public.events;
  v_registration public.event_registrations;
  v_confirmed int;
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to register for events';
  end if;

  select * into v_event
  from public.events e
  where e.id = p_event_id and e.status = 'published';
  if not found then
    raise exception 'EVENT_NOT_FOUND_OR_NOT_PUBLISHED';
  end if;

  select * into v_registration
  from public.event_registrations r
  where r.event_id = p_event_id and r.member_id = v_member;

  if not found then
    if v_event.capacity is not null then
      select count(*) into v_confirmed
      from public.event_registrations r
      where r.event_id = p_event_id and r.status in ('pending', 'confirmed', 'payment_failed');
      if v_confirmed >= v_event.capacity then
        raise exception 'EVENT_FULL';
      end if;
    end if;

    insert into public.event_registrations (event_id, member_id, status)
    values (
      p_event_id,
      v_member,
      case when v_event.price_cents > 0 then 'pending' else 'confirmed' end
    )
    returning * into v_registration;
  elsif v_registration.status = 'cancelled' then
    update public.event_registrations
    set status = case when v_event.price_cents > 0 then 'pending' else 'confirmed' end
    where id = v_registration.id
    returning * into v_registration;
  end if;

  if v_event.price_cents > 0 and v_registration.status in ('pending', 'payment_failed') then
    insert into public.orders (registration_id, member_id, amount_cents, status)
    values (v_registration.id, v_member, v_event.price_cents, 'pending');
  end if;

  return v_registration.id;
end;
$$;
`;

// settle_order without the settled-status early return: the second
// settle re-runs the gateway and rewrites the outcome (scenario 15 red).
const NON_IDEMPOTENT_SETTLE = `
create or replace function public.settle_order (p_order_id uuid, p_force_fail boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_order public.orders;
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to settle orders';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.member_id = v_member;
  if not found then
    raise exception 'ORDER_NOT_FOUND_OR_NOT_YOURS';
  end if;

  if p_force_fail then
    update public.orders set status = 'failed' where id = v_order.id;
    update public.event_registrations
    set status = 'payment_failed'
    where id = v_order.registration_id and status in ('pending', 'payment_failed');
    return 'failed';
  end if;

  update public.orders set status = 'succeeded' where id = v_order.id;
  update public.event_registrations
  set status = 'confirmed'
  where id = v_order.registration_id and status in ('pending', 'payment_failed');
  return 'succeeded';
end;
$$;
`;

const guards: Guard[] = [
  { name: "lock", breakSql: UNLOCKED_REGISTER },
  { name: "idempotency", breakSql: NON_IDEMPOTENT_SETTLE },
];

/**
 * In red mode, apply the matching guard and return its restore thunk
 * (call it in afterAll). Returns null in green mode.
 */
export async function applyRedGuard(): Promise<(() => Promise<void>) | null> {
  const red = process.env.PAYMENTS_RED;
  if (!red) return null;
  const g = guards.find((x) => x.name === red);
  if (!g) {
    throw new Error(
      `PAYMENTS_RED=${red} matches no guard (have: ${guards.map((x) => x.name).join(", ")})`,
    );
  }
  const a = await admin();
  const signature = red === "lock" ? "public.register_for_event(uuid)" : "public.settle_order(uuid,boolean)";
  const original = await a.query<{ definition: string }>("select pg_get_functiondef($1::regprocedure) as definition", [signature]);
  await a.query(g.breakSql);
  return async () => {
    await (await admin()).query(original.rows[0].definition);
  };
}

/** Restore CREATE OR REPLACE-clobbered grants after guard flips. */
export async function restoreFunctionGrants(): Promise<void> {
  const a = await admin();
  await a.query(
    `grant execute on function
       public.register_for_event (uuid),
       public.settle_order (uuid, boolean),
       public.cancel_registration (uuid)
     to authenticated`,
  );
}

export { runId };
