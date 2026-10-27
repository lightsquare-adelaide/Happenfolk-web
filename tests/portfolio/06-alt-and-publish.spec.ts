import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase, buildFixtures, cleanupFixtures, createUser, sessionCookieHeader,
  startApp, uploadRequest, type FixtureSet, type TestUser,
} from "../media/_harness";
import { apiCall, expectFriendly } from "../events/_http";
import { cleanupUsers } from "./_harness";

/**
 * Per-asset captions through the real pipeline: real uploads (synthesized
 * fixtures), real publication, and the new PATCH /api/portfolio/media
 * alt-editing route under the existing media-operation lease. Manager
 * publication omits the global altText override, so distinct captions
 * stay distinct; caption edits require an unpublished work so public
 * derivative captions never go stale.
 */

let app: { close: () => Promise<void> } | null = null;
let fixtures: FixtureSet;
const createdUsers: TestUser[] = [];
let owner: TestUser;
let stranger: TestUser;
let ownerCookie = "";
let strangerCookie = "";

beforeAll(async () => {
  app = await startApp();
  fixtures = await buildFixtures();
  owner = await createUser("portfolio-alt-owner");
  createdUsers.push(owner);
  stranger = await createUser("portfolio-alt-stranger");
  createdUsers.push(stranger);
  ownerCookie = await sessionCookieHeader(owner.email, owner.password);
  strangerCookie = await sessionCookieHeader(stranger.email, stranger.password);
}, 600_000);

afterAll(async () => {
  try {
    await cleanupUsers(createdUsers);
  } finally {
    try {
      if (fixtures) await cleanupFixtures(fixtures.dir);
    } finally {
      if (app) await app.close();
      app = null;
    }
  }
});

type UploadBody = { ok?: boolean; itemId?: string; assetId?: string; error?: string };

async function upload(cookie: string, name: string, data: Buffer, opts: { itemId?: string; altText?: string } = {}) {
  const res = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, name, data, opts));
  return { res, body: (await res.json()) as UploadBody };
}

async function callAlt(cookie: string | undefined, body: unknown, opts: { origin?: string; raw?: string } = {}) {
  return apiCall("PATCH", "/api/portfolio/media", {
    cookie, body: opts.raw !== undefined ? undefined : body, raw: opts.raw, origin: opts.origin,
  });
}

/** alt_text of every media row of one item, keyed by bucket/variant/path. */
async function altRows(itemId: string) {
  const { data, error } = await owner.client
    .from("media_assets")
    .select("path, alt_text, bucket, variant")
    .eq("portfolio_item_id", itemId)
    .order("bucket");
  expect(error).toBeNull();
  return (data ?? []) as { path: string; alt_text: string | null; bucket: string; variant: string }[];
}

describe("distinct captions survive publication", () => {
  let itemId = "";
  let assetOne = "";
  let assetTwo = "";

  it("uploads two assets with DIFFERENT per-asset alt text", async () => {
    const one = await upload(ownerCookie, "one.jpg", fixtures.gpsJpg, { altText: "First caption" });
    expect(one.res.status).toBe(201);
    itemId = one.body.itemId!;
    assetOne = one.body.assetId!;

    const two = await upload(ownerCookie, "two.jpg", fixtures.gpsJpg, { itemId, altText: "Second caption" });
    expect(two.res.status).toBe(201);
    assetTwo = two.body.assetId!;
  });

  it("publishes WITHOUT the global altText override and keeps both captions", async () => {
    const res = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(res.status).toBe(200);

    const rows = await altRows(itemId);
    const originals = rows.filter((r) => r.bucket === "drafts" && r.variant === "original");
    expect(originals.map((r) => r.alt_text).sort()).toEqual(["First caption", "Second caption"]);
    const publics = rows.filter((r) => r.bucket === "media");
    expect(publics.length).toBeGreaterThan(0);
    // Derivatives inherit their OWN original's caption — never one global value.
    const captions = new Set(publics.map((r) => r.alt_text));
    expect(captions.size).toBe(2);
    expect(captions.has("First caption")).toBe(true);
    expect(captions.has("Second caption")).toBe(true);
  });

  it("refuses caption edits while published (derivatives would go stale)", async () => {
    const res = await callAlt(ownerCookie, { itemId, assetId: assetOne, alt: "Edited while live" });
    expectFriendly(res, 409, "Unpublish");
    const rows = await altRows(itemId);
    const originals = rows.filter((r) => r.bucket === "drafts");
    expect(originals.map((r) => r.alt_text).sort()).toEqual(["First caption", "Second caption"]);
  });

  it("edits ONE caption after unpublish, leaving the other distinct, and republishes", async () => {
    const unpub = await apiCall("POST", "/api/media/unpublish", { cookie: ownerCookie, body: { itemId } });
    expect(unpub.status).toBe(200);

    const edit = await callAlt(ownerCookie, { itemId, assetId: assetOne, alt: "  Edited first caption  " });
    expect(edit.status).toBe(200);
    expect(edit.json).toMatchObject({ ok: true, altSaved: true });

    const rows = await altRows(itemId);
    const originals = rows.filter((r) => r.bucket === "drafts");
    expect(originals.map((r) => r.alt_text).sort()).toEqual(["Edited first caption", "Second caption"]);

    const repub = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(repub.status).toBe(200);
    const after = await altRows(itemId);
    const publicCaptions = new Set(after.filter((r) => r.bucket === "media").map((r) => r.alt_text));
    expect(publicCaptions).toEqual(new Set(["Edited first caption", "Second caption"]));
  });
});

describe("publication still refuses missing alt text", () => {
  it("rejects publishing an asset with no caption, then accepts after a per-asset edit", async () => {
    const up = await upload(ownerCookie, "no-alt.jpg", fixtures.gpsJpg);
    expect(up.res.status).toBe(201);
    const itemId = up.body.itemId!;

    const blocked = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(blocked.status).toBe(400);
    expect(blocked.json?.error).toContain("alt text");

    const { data: flag } = await owner.client.from("portfolio_items").select("published").eq("id", itemId).single();
    expect(flag!.published).toBe(false);

    const edit = await callAlt(ownerCookie, { itemId, assetId: up.body.assetId!, alt: "Now captioned" });
    expect(edit.status).toBe(200);

    const published = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(published.status).toBe(200);
  });
});

describe("alt route validation and ownership", () => {
  let itemId = "";
  let assetId = "";
  let strangerItemId = "";
  let strangerAssetId = "";

  beforeAll(async () => {
    const mine = await upload(ownerCookie, "mine.jpg", fixtures.gpsJpg, { altText: "Mine" });
    itemId = mine.body.itemId!;
    assetId = mine.body.assetId!;
    const theirs = await upload(strangerCookie, "theirs.jpg", fixtures.gpsJpg, { altText: "Theirs" });
    strangerItemId = theirs.body.itemId!;
    strangerAssetId = theirs.body.assetId!;
  });

  it("refuses malformed bodies with friendly problems", async () => {
    expectFriendly(await callAlt(ownerCookie, undefined, { raw: "null" }), 400, "JSON object");
    expectFriendly(await callAlt(ownerCookie, undefined, { raw: "[]" }), 400, "JSON object");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId }), 400, "Alt text must be text");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId, alt: "   " }), 400, "cannot be empty");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId, alt: "x".repeat(2001) }), 400, "at most 2000");
    expectFriendly(await callAlt(ownerCookie, { itemId: "nope", assetId, alt: "x" }), 400, "identifier");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId: "nope", alt: "x" }), 400, "identifier");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId, alt: "x", published: false }), 400, "Unsupported field: published");
  });

  it("refuses anonymous callers and cross-origin requests", async () => {
    expectFriendly(await callAlt(undefined, { itemId, assetId, alt: "x" }), 401, "Sign in first");
    expectFriendly(await callAlt(ownerCookie, { itemId, assetId, alt: "x" }, { origin: "https://evil.example" }), 403, "Cross-origin");
  });

  it("refuses strangers with 404 and leaves their caption unchanged", async () => {
    const crossItem = await callAlt(ownerCookie, { itemId: strangerItemId, assetId: strangerAssetId, alt: "Stolen" });
    expectFriendly(crossItem, 404, "not found");

    const crossAsset = await callAlt(ownerCookie, { itemId, assetId: strangerAssetId, alt: "Stolen" });
    expectFriendly(crossAsset, 404, "Media not found");

    const { data } = await stranger.client.from("media_assets").select("alt_text").eq("id", strangerAssetId).single();
    expect(data!.alt_text).toBe("Theirs");
  });

  it("refuses editing through a PUBLISHED derivative row id", async () => {
    const published = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(published.status).toBe(200);
    const { data: derivative } = await owner.client
      .from("media_assets")
      .select("id")
      .eq("portfolio_item_id", itemId)
      .eq("bucket", "media")
      .limit(1)
      .maybeSingle();
    expect(derivative).not.toBeNull();
    // The item is published, so the unpublish-first rule answers first.
    const whilePublished = await callAlt(ownerCookie, { itemId, assetId: derivative!.id, alt: "Sneaky" });
    expectFriendly(whilePublished, 409, "Unpublish");

    await apiCall("POST", "/api/media/unpublish", { cookie: ownerCookie, body: { itemId } });
    // Unpublished: derivative rows are gone; the id no longer resolves.
    const afterUnpublish = await callAlt(ownerCookie, { itemId, assetId: derivative!.id, alt: "Sneaky" });
    expectFriendly(afterUnpublish, 404, "Media not found");
  });
});
