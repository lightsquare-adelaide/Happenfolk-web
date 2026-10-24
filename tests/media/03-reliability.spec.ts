import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appBase, buildFixtures, cleanupFixtures, closeApp, createUser, jsonRequest, sessionCookieHeader, stackConfig, startApp, uploadRequest, type FixtureSet, type TestUser } from "./_harness";

describe("media integration reliability", () => {
  let owner: TestUser, stranger: TestUser, cookie: string, strangerCookie: string, fixtures: FixtureSet;
  beforeAll(async () => {
    fixtures = await buildFixtures();
    owner = await createUser("media-reliability");
    stranger = await createUser("media-denied");
    cookie = await sessionCookieHeader(owner.email, owner.password);
    strangerCookie = await sessionCookieHeader(stranger.email, stranger.password);
    await startApp();
  }, 300_000);
  afterAll(async () => { await closeApp(); if (fixtures) await cleanupFixtures(fixtures.dir); });

  async function upload() {
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "image.jpg", fixtures.gpsJpg, { altText: "A synthetic test image" }));
    expect(response.status).toBe(201);
    return await response.json() as { itemId: string; path: string; assetId: string };
  }
  const action = (name: string, itemId: string, actingCookie = cookie) => fetch(`${appBase()}/api/media/${name}`, jsonRequest(actingCookie, { itemId }));

  it("repeated publication converges to exactly two public variants", async () => {
    const { itemId } = await upload();
    expect((await action("publish", itemId)).status).toBe(200);
    expect((await action("publish", itemId)).status).toBe(200);
    const { data, error } = await owner.client.from("media_assets").select("path").eq("portfolio_item_id", itemId).eq("bucket", "media");
    expect(error).toBeNull(); expect(data).toHaveLength(2);
    expect(new Set(data?.map(row => row.path)).size).toBe(2);
  });

  it("concurrent publish requests leave no duplicate rows and can be unpublished", async () => {
    const { itemId, path } = await upload();
    const responses = await Promise.all([action("publish", itemId), action("publish", itemId)]);
    expect(responses.map(r => r.status).every(status => status === 200 || status === 409)).toBe(true);
    const rows = await owner.client.from("media_assets").select("path").eq("portfolio_item_id", itemId).eq("bucket", "media");
    expect(rows.data).toHaveLength(2);
    const publicPaths = rows.data!.map(r => r.path);
    expect((await action("unpublish", itemId)).status).toBe(200);
    for (const publicPath of publicPaths) {
      expect((await fetch(`${stackConfig().url}/storage/v1/object/public/media/${publicPath}`)).ok).toBe(false);
    }
    expect((await owner.client.storage.from("drafts").download(path)).error).toBeNull();
  });

  it("rejects anonymous and other-owner lifecycle operations", async () => {
    const { itemId } = await upload();
    for (const name of ["publish", "unpublish"]) {
      expect((await action(name, itemId, "")).status).toBe(401);
      expect((await action(name, itemId, strangerCookie)).status).toBe(404);
    }
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(strangerCookie, "intruder.jpg", fixtures.gpsJpg, { itemId }));
    expect(response.status).toBe(404);
  });

  it("rejects a corrupt JPEG without leaving an empty work or storage object", async () => {
    const before = await owner.client.from("portfolio_items").select("id").eq("profile_id", owner.userId);
    const objectsBefore = await owner.client.storage.from("drafts").list(owner.userId);
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "broken.jpg", Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 3])));
    expect(response.status).toBe(400);
    const after = await owner.client.from("portfolio_items").select("id").eq("profile_id", owner.userId);
    const objectsAfter = await owner.client.storage.from("drafts").list(owner.userId);
    expect(after.data).toHaveLength(before.data!.length);
    expect(objectsAfter.data).toHaveLength(objectsBefore.data!.length);
  });
  it("preflights all masters before exposing any derivative", async () => {
    const first = await upload();
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "second.jpg", fixtures.gpsJpg, { itemId: first.itemId, altText: "Second synthetic image" }));
    const second = await response.json() as {path: string};
    await owner.client.storage.from("drafts").remove([second.path]);
    expect((await action("publish", first.itemId)).status).toBe(500);
    const rows = await owner.client.from("media_assets").select("id").eq("portfolio_item_id", first.itemId).eq("bucket", "media");
    expect(rows.data).toHaveLength(0);
    const stem = first.path.split("/")[1].replace(/\.[^.]+$/, "");
    const objects = await owner.client.storage.from("media").list(owner.userId);
    expect(objects.data?.filter(object => object.name.startsWith(stem))).toHaveLength(0);
  });

  it("updates original and public ordering atomically while preserving ownership", async () => {
    const first = await upload();
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "second.jpg", fixtures.gpsJpg, { itemId: first.itemId, altText: "Second image for ordering" }));
    const second = await response.json() as {assetId: string};
    expect((await action("publish", first.itemId)).status).toBe(200);
    const reorder = (actingCookie: string) => fetch(`${appBase()}/api/media/reorder`, jsonRequest(actingCookie, { itemId: first.itemId, assetId: second.assetId, direction: "up" }));
    expect((await reorder(strangerCookie)).status).toBe(404);
    expect((await reorder(cookie)).status).toBe(200);
    const originals = await owner.client.from("media_assets").select("id, position").eq("portfolio_item_id", first.itemId).eq("variant", "original").order("position");
    expect(originals.data?.map(row => row.id)).toEqual([second.assetId, first.assetId]);
    const variants = await owner.client.from("media_assets").select("position").eq("portfolio_item_id", first.itemId).eq("bucket", "media");
    expect(variants.data?.map(row => row.position).sort()).toEqual([0,0,1,1]);
  });

  it("rejects cross-origin browser mutations", async () => {
    const first = await upload();
    const options = jsonRequest(cookie, {itemId: first.itemId});
    options.headers = {...options.headers, origin: "https://attacker.example"};
    expect((await fetch(`${appBase()}/api/media/publish`, options)).status).toBe(403);
  });

  it("rejects JSON null, arrays and primitive bodies without crashing", async () => {
    for (const route of ["publish", "unpublish", "reorder"]) {
      for (const body of [null, [], "bad", 42]) {
        const response = await fetch(`${appBase()}/api/media/${route}`, jsonRequest(cookie, body));
        expect(response.status).toBe(400);
      }
    }
  });

});
