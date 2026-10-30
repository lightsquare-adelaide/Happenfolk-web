import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { appBase, createUser, sessionCookieHeader, startApp, type TestUser } from "../media/_harness";
import { stackConfig } from "../access/_harness";

/**
 * W2 participation history on the real stack: /dashboard/history must
 * list the signed-in member's own hosted, collaborated and registered
 * events, and never another member's. Authorization is not mocked —
 * every read goes through the real Next server, real auth cookies and
 * RLS.
 */

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const names = {
  organiserUpcoming: `History organiser upcoming ${runId}`,
  collaboration: `History collaboration ${runId}`,
  pastFree: `History past free ${runId}`,
  paid: `History paid ${runId}`,
  memberDraft: `History member draft ${runId}`,
  otherOnly: `History other member only ${runId}`,
  cancelledAfter: `History cancelled after signup ${runId}`,
};

const DAY = 86_400_000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY).toISOString();

let organiser: TestUser;
let member: TestUser;
let other: TestUser;
let memberCookie = "";
let otherCookie = "";
let app: Awaited<ReturnType<typeof startApp>> | undefined;
const eventIds: string[] = [];

beforeAll(async () => {
  app = await startApp();
  [organiser, member, other] = await Promise.all([
    createUser("history-organiser"),
    createUser("history-member"),
    createUser("history-other"),
  ]);
  await Promise.all([organiser, member, other].map((user) =>
    user.client.from("profiles")
      .update({ published: true, category_id: 1, account_kind: "individual" })
      .eq("id", user.userId)));
  memberCookie = await sessionCookieHeader(member.email, member.password);
  otherCookie = await sessionCookieHeader(other.email, other.password);

  const insert = async (host: TestUser, title: string, startsAt: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const inserted = await host.client.from("events").insert({
      host_id: host.userId, title, starts_at: startsAt,
      location: "Adelaide test venue", ...extra,
    }).select("id").single();
    expect(inserted.error, `insert ${title}: ${inserted.error?.message}`).toBeNull();
    eventIds.push(inserted.data!.id);
    return inserted.data!.id;
  };

  // Organiser's own upcoming event (member must NOT see it in history).
  await insert(organiser, names.organiserUpcoming, iso(3), { price_cents: 0, status: "published" });
  // Collaboration: member is on the roster, organiser hosts.
  const collaborationId = await insert(organiser, names.collaboration, iso(5), { price_cents: 0, status: "published" });
  const roster = await organiser.client.from("event_collaborators")
    .insert({ event_id: collaborationId, profile_id: member.userId, role: "collaborator" });
  expect(roster.error, `add collaborator: ${roster.error?.message}`).toBeNull();
  // Past free event the member registered for.
  const pastFreeId = await insert(organiser, names.pastFree, iso(-7), { price_cents: 0, status: "published" });
  await expect(member.client.rpc("register_for_event", { p_event_id: pastFreeId })).resolves.toHaveProperty("error", null);
  // Paid event the member registered for and settled.
  const paidId = await insert(organiser, names.paid, iso(6), { price_cents: 2500, status: "published" });
  const paidRegistration = await member.client.rpc("register_for_event", { p_event_id: paidId });
  expect(paidRegistration.error).toBeNull();
  const paidOrder = await member.client.from("orders").select("id")
    .eq("registration_id", paidRegistration.data as string).single();
  expect(paidOrder.error).toBeNull();
  await expect(member.client.rpc("settle_order", { p_order_id: paidOrder.data!.id })).resolves.toHaveProperty("error", null);
  // Member's own hosted draft (team-only, links to the studio manager).
  await insert(member, names.memberDraft, iso(10), { status: "draft" });
  // Published event that gets cancelled AFTER the member registered —
  // RLS then hides it from the member, so it must surface as
  // "Event unavailable" without leaking details.
  const cancelledAfterId = await insert(organiser, names.cancelledAfter, iso(4), { price_cents: 0, status: "published" });
  await expect(member.client.rpc("register_for_event", { p_event_id: cancelledAfterId })).resolves.toHaveProperty("error", null);
  const cancelled = await organiser.client.from("events").update({ status: "cancelled" }).eq("id", cancelledAfterId);
  expect(cancelled.error, `cancel event: ${cancelled.error?.message}`).toBeNull();
  // The other member's own history: a registration on the organiser's
  // upcoming event plus an event only they host.
  await expect(other.client.rpc("register_for_event", { p_event_id: eventIds[0] })).resolves.toHaveProperty("error", null);
  await insert(other, names.otherOnly, iso(8), { price_cents: 0, status: "published" });
}, 180_000);

afterAll(async () => {
  await app?.close();
  const admin = new pg.Client({ connectionString: stackConfig().dbUrl });
  await admin.connect();
  try {
    if (eventIds.length) {
      await admin.query("delete from public.events where id = any($1::uuid[])", [eventIds]);
    }
    for (const user of [organiser, member, other].filter(Boolean)) {
      await admin.query("delete from auth.users where id = $1", [user.userId]);
    }
  } finally {
    await admin.end();
  }
});

test("history requires a session", async () => {
  const response = await fetch(`${appBase()}/dashboard/history`, { redirect: "manual" });
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toContain("/login");
});

test("member sees own hosted, collaborated and registered events only", async () => {
  const response = await fetch(`${appBase()}/dashboard/history`, { headers: { cookie: memberCookie } });
  expect(response.status).toBe(200);
  const html = await response.text();

  // Own involvement: hosted draft, collaboration, registrations.
  expect(html).toContain(names.memberDraft);
  expect(html).toContain(names.collaboration);
  expect(html).toContain(names.pastFree);
  expect(html).toContain(names.paid);
  expect(html).toContain("Collaborator");
  expect(html).toContain("Host");
  expect(html).toContain("Confirmed");
  expect(html).toContain("Order: succeeded");
  expect(html).toContain("Registered");

  // Anyone else's history must stay out.
  expect(html).not.toContain(names.organiserUpcoming);
  expect(html).not.toContain(names.otherOnly);

  // Links: published events link to the public page, the member's own
  // draft links to the studio event manager.
  expect(html).toContain(`href="/events/${eventIds[1]}"`);
  expect(html).toContain(`href="/events/${eventIds[2]}"`);
  expect(html).toContain('href="/dashboard/events"');

  // The timeline splits by starts_at: upcoming rows render before the
  // past registration.
  expect(html.indexOf(names.collaboration)).toBeLessThan(html.indexOf(names.pastFree));

  // A cancelled-after-signup event is RLS-hidden: no title leak, the
  // row surfaces as unavailable.
  expect(html).not.toContain(names.cancelledAfter);
  expect(html).toContain("Event unavailable");
});

test("another member sees their own history, not the first member's", async () => {
  const response = await fetch(`${appBase()}/dashboard/history`, { headers: { cookie: otherCookie } });
  expect(response.status).toBe(200);
  const html = await response.text();

  expect(html).toContain(names.organiserUpcoming); // registered
  expect(html).toContain(names.otherOnly); // hosted
  expect(html).not.toContain(names.memberDraft);
  expect(html).not.toContain(names.collaboration);
  expect(html).not.toContain(names.pastFree);
  expect(html).not.toContain(names.paid);
  expect(html).not.toContain(names.cancelledAfter);
});
