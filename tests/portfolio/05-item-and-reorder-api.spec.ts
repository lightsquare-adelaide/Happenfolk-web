import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase, createUser, sessionCookieHeader, startApp, type TestUser,
} from "../media/_harness";
import { apiCall, expectFriendly, type ApiResult } from "../events/_http";
import { cleanupUsers, listOwnerOrder } from "./_harness";

/**
 * Real-stack HTTP integration for the manager item + reorder API:
 * real Next server, real auth cookies, RLS and the accepted ordering
 * RPC underneath. Denials are asserted by DATA STATE (read-back), and
 * every error must stay friendly (no raw database text).
 */

let app: { close: () => Promise<void> } | null = null;
// Immutable registry: every user this file creates is tracked here at
// creation time, so a later `owner = mover` reassignment can never drop
// a user out of the scoped cleanup (P2-CLEANUP-REPRO finding).
const createdUsers: TestUser[] = [];
let owner: TestUser;
let stranger: TestUser;
let ownerCookie = "";
let strangerCookie = "";

beforeAll(async () => {
  app = await startApp();
  owner = await createUser("portfolio-api-owner");
  stranger = await createUser("portfolio-api-stranger");
  createdUsers.push(owner, stranger);
  ownerCookie = await sessionCookieHeader(owner.email, owner.password);
  strangerCookie = await sessionCookieHeader(stranger.email, stranger.password);
}, 600_000);

afterAll(async () => {
  await cleanupUsers(createdUsers);
  if (app) await app.close();
  app = null;
});

const post = (cookie: string | undefined, body: unknown, opts: { raw?: string; origin?: string; secFetchSite?: string } = {}) =>
  apiCall("POST", "/api/portfolio/items", { cookie, body: opts.raw !== undefined || body === undefined ? undefined : body, raw: opts.raw, origin: opts.origin, secFetchSite: opts.secFetchSite });

describe("POST /api/portfolio/items", () => {
  it("creates draft works that append deterministically", async () => {
    const first = await post(ownerCookie, { title: "Harbour Study", description: "Oil on board", year: 2001, tags: ["  SEA ", "sea", "harbour"] });
    expect(first.status).toBe(201);
    expect(first.json?.ok).toBe(true);
    const item = (first.json as { item?: Record<string, unknown> }).item!;
    expect(item.title).toBe("Harbour Study");
    expect(item.year).toBe(2001);
    expect(item.tags).toEqual(["sea", "harbour"]);
    expect(item.position).toBe(0);

    const second = await post(ownerCookie, { title: "Second Work" });
    expect(second.status).toBe(201);
    expect((second.json as { item?: Record<string, unknown> }).item!.position).toBe(1);

    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.position)).toEqual([0, 1]);
  });

  it("refuses malformed JSON shapes: null, array, scalar, non-JSON", async () => {
    for (const raw of ["null", "[]", '"text"', "7"]) {
      expectFriendly(await post(ownerCookie, undefined, { raw }), 400, "JSON object");
    }
    const notJson = await apiCall("POST", "/api/portfolio/items", {
      cookie: ownerCookie, raw: "{not json", origin: appBase(),
    });
    expectFriendly(notJson, 400, "Request body must be JSON");
  });

  it("refuses invalid and out-of-bound fields with friendly problems", async () => {
    expectFriendly(await post(ownerCookie, { title: "   " }), 400, "Title is required");
    expectFriendly(await post(ownerCookie, { title: "t".repeat(121) }), 400, "at most 120");
    expectFriendly(await post(ownerCookie, { title: "x", year: 1700 }), 400, "Year must be");
    expectFriendly(await post(ownerCookie, { title: "x", year: 2101 }), 400, "Year must be");
    expectFriendly(await post(ownerCookie, { title: "x", year: 1999.5 }), 400, "Year must be");
    expectFriendly(await post(ownerCookie, { title: "x", tags: "sea" }), 400, "array of strings");
    expectFriendly(await post(ownerCookie, { title: "x", tags: [{}] }), 400, "array of strings");
    expectFriendly(await post(ownerCookie, { title: "x", tags: [1] }), 400, "array of strings");
    expectFriendly(await post(ownerCookie, { title: "x", description: 5 }), 400, "Description must be text");
    expectFriendly(await post(ownerCookie, {}), 400, "Title is required");
  });

  it("refuses unsupported keys instead of silently dropping them", async () => {
    expectFriendly(await post(ownerCookie, { title: "x", profile_id: stranger.userId }), 400, "Unsupported field: profile_id");
    expectFriendly(await post(ownerCookie, { title: "x", published: true }), 400, "Unsupported field: published");
    expectFriendly(await post(ownerCookie, { title: "x", position: 0 }), 400, "Unsupported field: position");
    // Nothing was created by the refused calls above beyond the two items
    // from the first test plus the ones other cases created (none).
    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order).toHaveLength(2);
  });

  it("refuses anonymous callers and cross-origin browsers", async () => {
    expectFriendly(await post(undefined, { title: "Anon" }), 401, "Sign in first");
    expectFriendly(await post(ownerCookie, { title: "Evil" }, { origin: "https://evil.example" }), 403, "Cross-origin");
    expectFriendly(await post(ownerCookie, { title: "Evil" }, { secFetchSite: "cross-site" }), 403, "Cross-origin");
    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order).toHaveLength(2);
  });
});

describe("PATCH /api/portfolio/items/[id]", () => {
  let itemId = "";

  beforeAll(async () => {
    const created = await post(ownerCookie, { title: "Editable Work", year: 1999, tags: ["oil"] });
    itemId = (created.json as { item?: { id?: string} }).item!.id!;
  });

  it("edits title/description/year/tags and reads back the real state", async () => {
    const res = await apiCall("PATCH", `/api/portfolio/items/${itemId}`, {
      cookie: ownerCookie, body: { title: " Renamed Work ", description: "Updated", year: 2020, tags: ["  OIL ", "sea"] },
    });
    expect(res.status).toBe(200);
    const { data } = await owner.client.from("portfolio_items")
      .select("title, description, year, tags").eq("id", itemId).single();
    expect(data).toMatchObject({ title: "Renamed Work", description: "Updated", year: 2020, tags: ["oil", "sea"] });
  });

  it("clears optional fields", async () => {
    const res = await apiCall("PATCH", `/api/portfolio/items/${itemId}`, {
      cookie: ownerCookie, body: { description: null, year: null, tags: [] },
    });
    expect(res.status).toBe(200);
    const { data } = await owner.client.from("portfolio_items")
      .select("description, year, tags").eq("id", itemId).single();
    expect(data).toMatchObject({ description: null, year: null, tags: [] });
  });

  it("refuses metadata-foreign fields with zero data change", async () => {
    for (const body of [
      { title: "x", published: true },
      { title: "x", profile_id: stranger.userId },
      { title: "x", position: 99 },
      { title: "x", media_kind: "video" },
    ]) {
      const res = await apiCall("PATCH", `/api/portfolio/items/${itemId}`, { cookie: ownerCookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const { data } = await owner.client.from("portfolio_items")
      .select("published, profile_id, position, media_kind").eq("id", itemId).single();
    expect(data!.published).toBe(false);
    expect(data!.profile_id).toBe(owner.userId);
    expect(data!.media_kind).toBe("image");
  });

  it("refuses an empty patch and malformed bodies", async () => {
    expectFriendly(await apiCall("PATCH", `/api/portfolio/items/${itemId}`, { cookie: ownerCookie, body: {} }), 400, "No fields to update");
    expectFriendly(await apiCall("PATCH", `/api/portfolio/items/${itemId}`, { cookie: ownerCookie, raw: "[]" }), 400, "JSON object");
    expectFriendly(await apiCall("PATCH", "/api/portfolio/items/not-a-uuid", { cookie: ownerCookie, body: { title: "x" } }), 400, "Invalid work identifier");
  });

  it("gives a stranger 404 and leaves the owner's row untouched", async () => {
    const res = await apiCall("PATCH", `/api/portfolio/items/${itemId}`, { cookie: strangerCookie, body: { title: "Plagiarised" } });
    expectFriendly(res as ApiResult, 404, "not yours");
    const anon = await apiCall("PATCH", `/api/portfolio/items/${itemId}`, { body: { title: "Anon" } });
    expectFriendly(anon, 401, "Sign in first");
    const { data } = await owner.client.from("portfolio_items").select("title").eq("id", itemId).single();
    expect(data!.title).toBe("Renamed Work");
  });
});

describe("POST /api/portfolio/reorder", () => {
  let mover: TestUser;
  let a = "";
  let b = "";
  let c = "";

  beforeAll(async () => {
    mover = await createUser("portfolio-api-mover");
    createdUsers.push(mover);
    owner = mover;
    ownerCookie = await sessionCookieHeader(mover.email, mover.password);
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) {
      const created = await post(ownerCookie, { title });
      ids.push((created.json as { item?: { id?: string } }).item!.id!);
    }
    [a, b, c] = ids;
  });

  const reorder = (cookie: string | undefined, body: unknown, opts: { raw?: string; origin?: string } = {}) =>
    apiCall("POST", "/api/portfolio/reorder", { cookie, body: opts.raw !== undefined ? undefined : body, raw: opts.raw, origin: opts.origin });

  async function orderIds(): Promise<string[]> {
    return (await listOwnerOrder(owner.client, owner.userId)).map((r) => r.id);
  }

  it("moves items up and down through the accepted transaction", async () => {
    const up = await reorder(ownerCookie, { itemId: c, direction: "up" });
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ ok: true, moved: true });
    expect(await orderIds()).toEqual([a, c, b]);

    const down = await reorder(ownerCookie, { itemId: a, direction: "down" });
    expect(down.json).toMatchObject({ ok: true, moved: true });
    expect(await orderIds()).toEqual([c, a, b]);
  });

  it("reports edge no-ops as moved=false with unchanged data", async () => {
    const firstUp = await reorder(ownerCookie, { itemId: c, direction: "up" });
    expect(firstUp.json).toMatchObject({ ok: true, moved: false });
    const lastDown = await reorder(ownerCookie, { itemId: b, direction: "down" });
    expect(lastDown.json).toMatchObject({ ok: true, moved: false });
    expect(await orderIds()).toEqual([c, a, b]);
  });

  it("refuses malformed bodies", async () => {
    expectFriendly(await reorder(ownerCookie, undefined, { raw: "null" }), 400, "JSON object");
    expectFriendly(await reorder(ownerCookie, { itemId: a }), 400, "direction");
    expectFriendly(await reorder(ownerCookie, { itemId: "nope", direction: "up" }), 400, "itemId");
    expectFriendly(await reorder(ownerCookie, { itemId: a, direction: "sideways" }), 400, "direction");
    expectFriendly(await reorder(ownerCookie, { itemId: a, direction: "up", position: 1 }), 400, "Unsupported field: position");
  });

  it("refuses strangers and anonymous callers with unchanged data", async () => {
    const strangerRes = await reorder(strangerCookie, { itemId: a, direction: "down" });
    expectFriendly(strangerRes, 404, "not yours");
    const anonRes = await reorder(undefined, { itemId: a, direction: "down" });
    expectFriendly(anonRes, 401, "Sign in first");
    const evilOrigin = await reorder(ownerCookie, { itemId: a, direction: "down" }, { origin: "https://evil.example" });
    expectFriendly(evilOrigin, 403, "Cross-origin");
    expect(await orderIds()).toEqual([c, a, b]);
  });
});
