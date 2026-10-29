import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase,
  closeApp,
  createUser,
  loadFixtures,
  resetGatewaySwitch,
  sessionCookieHeader,
  startApp,
} from "./_harness";

/**
 * The P7 surfaces over real HTTP: the register API's 401 for anon,
 * the free happy path, the dashboard list, and the stub gateway page —
 * banner verbatim (hard rule 1) and ZERO card fields in the DOM
 * (hard rule 2).
 */

const BANNER = "Simulated payment — no money moves and no card details are collected.";

let memberCookie: string;
let freeEventId: string;
let paidEventId: string;

beforeAll(async () => {
  await loadFixtures();
  const extra = await createUser("httpmember");
  // /dashboard is gated by middleware on completed onboarding, not
  // just session presence — give the extra member a category first.
  const { error } = await extra.client
    .from("profiles")
    .update({ category_id: 4 })
    .eq("id", extra.userId);
  if (error) throw new Error(`onboarding failed: ${error.message}`);
  memberCookie = await sessionCookieHeader(extra.email, extra.password);
  freeEventId = (await loadFixtures()).freeEventId;
  paidEventId = (await loadFixtures()).paidEventId;
  await startApp();
}, 120_000);

afterAll(async () => {
  await closeApp();
  await resetGatewaySwitch();
});

describe("P7 — registration over HTTP", () => {
  it("rejects anonymous registration with 401 and a login hint", async () => {
    const res = await fetch(`${appBase()}/api/events/${freeEventId}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error?: string };
    expect(data.error).toContain("Sign in");
  });

  it("confirms a free registration and shows it on the dashboard", async () => {
    const res = await fetch(`${appBase()}/api/events/${freeEventId}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok?: boolean; status?: string };
    expect(data.ok).toBe(true);
    expect(data.status).toBe("confirmed");

    const page = await fetch(`${appBase()}/dashboard/registrations`, {
      headers: { cookie: memberCookie },
      redirect: "manual",
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("My registrations");
    expect(html).toContain("Confirmed");
  });
});

describe("P7 — stub gateway over HTTP", () => {
  it("renders the verbatim banner and no card fields, ever", async () => {
    // Create a paid registration + pending order through the API.
    const register = await fetch(`${appBase()}/api/events/${paidEventId}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
    });
    const { orderId } = (await register.json()) as { orderId?: string };
    expect(orderId).toBeTruthy();

    const res = await fetch(`${appBase()}/dashboard/orders/${orderId}`, {
      headers: { cookie: memberCookie },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Hard rule 1: banner verbatim.
    expect(html).toContain(BANNER);
    // Hard rule 2: no card inputs of any kind (name, autocomplete,
    // placeholder, or iframe-embedded fake provider).
    expect(html).not.toMatch(/<input[^>]*(card|cc-)/i);
    expect(html).not.toMatch(/autocomplete=["'][^"']*cc-/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/stripe|paypal/i);
  });

  it("settles through the API: success confirms; the switch is restored", async () => {
    const register = await fetch(`${appBase()}/api/events/${paidEventId}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
    });
    const { orderId } = (await register.json()) as { orderId?: string };

    const settle = await fetch(`${appBase()}/api/orders/${orderId}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: memberCookie },
      body: JSON.stringify({ outcome: "succeeded" }),
    });
    expect(settle.status).toBe(200);
    const data = (await settle.json()) as { orderStatus?: string; registrationStatus?: string };
    expect(data.orderStatus).toBe("succeeded");
    expect(data.registrationStatus).toBe("confirmed");
  });
});

describe("R — paid booking boundaries and retry over HTTP", () => {
  const post = (path: string, body?: unknown, cookie = memberCookie) => fetch(`${appBase()}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual",
  });

  it("offers paid participation and keeps anonymous orders behind login", async () => {
    const participation = await fetch(`${appBase()}/events/${paidEventId}/participate`, { headers: { cookie: memberCookie } });
    expect(participation.status).toBe(200);
    expect(await participation.text()).toContain("Continue to simulated payment");
    const response = await fetch(`${appBase()}/dashboard/orders/00000000-0000-4000-8000-000000000001`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=");
  });

  it("fails, retries to a new order on the same registration, cancels, then revives and succeeds", async () => {
    const member = await createUser("http-retry");
    await member.client.from("profiles").update({ category_id: 4 }).eq("id", member.userId);
    const cookie = await sessionCookieHeader(member.email, member.password);
    const registered = await post(`/api/events/${paidEventId}/register`, undefined, cookie);
    expect(registered.status).toBe(200);
    const first = await registered.json() as { registrationId: string; orderId: string };
    expect(first.orderId).toBeTruthy();
    const failed = await post(`/api/orders/${first.orderId}/settle`, { outcome: "failed" }, cookie);
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ orderStatus: "failed", registrationStatus: "payment_failed" });
    const history = await fetch(`${appBase()}/dashboard/orders/${first.orderId}`, { headers: { cookie } });
    const historyHtml = await history.text();
    expect(historyHtml).toContain("Retry payment (creates a new order)");
    expect(historyHtml).not.toContain(">Payment succeeded</button>");

    const retry = await post(`/api/events/${paidEventId}/register`, undefined, cookie);
    expect(retry.status).toBe(200);
    const second = await retry.json() as { registrationId: string; orderId: string };
    expect(second.registrationId).toBe(first.registrationId);
    expect(second.orderId).toBeTruthy();
    expect(second.orderId).not.toBe(first.orderId);
    const list = await fetch(`${appBase()}/dashboard/registrations`, { headers: { cookie } });
    const html = await list.text();
    expect(html).toContain(`/dashboard/orders/${first.orderId}`);
    expect(html).toContain(`/dashboard/orders/${second.orderId}`);

    const cancelled = await post(`/api/registrations/${first.registrationId}/cancel`, undefined, cookie);
    expect(cancelled.status).toBe(200);
    const refused = await post(`/api/orders/${second.orderId}/settle`, { outcome: "succeeded" }, cookie);
    expect(refused.status).toBe(409);
    const stillPending = await member.client.from("orders").select("status").eq("id", second.orderId).single();
    expect(stillPending.data?.status).toBe("pending");
    const revived = await post(`/api/events/${paidEventId}/register`, undefined, cookie);
    expect(await revived.json()).toMatchObject({ registrationId: first.registrationId, orderId: second.orderId });
    const succeeded = await post(`/api/orders/${second.orderId}/settle`, { outcome: "succeeded" }, cookie);
    expect(await succeeded.json()).toMatchObject({ orderStatus: "succeeded", registrationStatus: "confirmed" });
    const oldHistory = await fetch(`${appBase()}/dashboard/orders/${first.orderId}`, { headers: { cookie } });
    expect(await oldHistory.text()).not.toContain("Retry payment (creates a new order)");
    const settledHistory = await member.client.from("orders").select("id, status").eq("registration_id", first.registrationId);
    expect(settledHistory.data).toEqual(expect.arrayContaining([
      { id: first.orderId, status: "failed" }, { id: second.orderId, status: "succeeded" },
    ]));
  });

  it("rejects foreign orders and cancellations without exposing the order page", async () => {
    const owner = await createUser("http-foreign-owner");
    const ownerCookie = await sessionCookieHeader(owner.email, owner.password);
    const registered = await post(`/api/events/${paidEventId}/register`, undefined, ownerCookie);
    const { orderId, registrationId } = await registered.json() as { orderId: string; registrationId: string };
    const outsider = await createUser("http-outsider");
    await outsider.client.from("profiles").update({ category_id: 4 }).eq("id", outsider.userId);
    const cookie = await sessionCookieHeader(outsider.email, outsider.password);
    expect((await post(`/api/orders/${orderId}/settle`, { outcome: "failed" }, cookie)).status).toBe(404);
    expect((await post(`/api/registrations/${registrationId}/cancel`, undefined, cookie)).status).toBe(404);
    const hidden = await fetch(`${appBase()}/dashboard/orders/${orderId}`, { headers: { cookie } });
    const hiddenHtml = await hidden.text();
    // Next may stream headers before notFound resolves; the denial must
    // render no order details regardless of the streamed HTTP status.
    expect([200, 404]).toContain(hidden.status);
    expect(hiddenHtml).toContain("Not found");
    expect(hiddenHtml).toContain('name="robots" content="noindex"');
    expect(hiddenHtml).not.toContain(BANNER);
    expect(hiddenHtml).not.toContain('aria-label="Order details"');
  });

  it("validates identifiers, JSON outcomes, anonymous mutations, and request origin", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const path of [`/api/events/${id}/register`, `/api/orders/${id}/settle`, `/api/registrations/${id}/cancel`]) {
      expect((await post(path, { outcome: "succeeded" }, "")).status).toBe(401);
      expect((await fetch(`${appBase()}${path}`, { method: "POST", headers: { cookie: memberCookie, origin: "https://foreign.example" } })).status).toBe(403);
      expect((await post(path.replace(id, "invalid"))).status).toBe(400);
    }
    for (const body of [null, [], {}, { outcome: "unknown" }]) {
      expect((await post(`/api/orders/${id}/settle`, body)).status).toBe(400);
    }
    const invalid = await fetch(`${appBase()}/api/orders/${id}/settle`, { method: "POST", headers: { cookie: memberCookie }, body: "{" });
    expect(invalid.status).toBe(400);
  });
});
