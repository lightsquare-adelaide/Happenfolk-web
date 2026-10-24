import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stackConfig as databaseConfig } from "../access/_harness";
import { appBase, buildFixtures, cleanupFixtures, closeApp, createUser, jsonRequest, sessionCookieHeader, stackConfig, startApp, uploadRequest, type FixtureSet, type TestUser } from "./_harness";

describe("unpublish failure boundaries", () => {
  let owner: TestUser, cookie: string, fixtures: FixtureSet;
  beforeAll(async () => {
    fixtures = await buildFixtures(); owner = await createUser("media-query-failure");
    cookie = await sessionCookieHeader(owner.email, owner.password); await startApp();
  }, 300_000);
  afterAll(async () => { await closeApp(); if (fixtures) await cleanupFixtures(fixtures.dir); });

  it("reports failure and preserves publication when metadata cannot be read", async () => {
    const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "failure.jpg", fixtures.gpsJpg, {altText: "Failure boundary image"}));
    const {itemId} = await response.json() as {itemId: string};
    const published = await fetch(`${appBase()}/api/media/publish`, jsonRequest(cookie, {itemId}));
    const {publicPaths} = await published.json() as {publicPaths: string[]};
    const db = new pg.Client({connectionString: databaseConfig().dbUrl}); await db.connect();
    try {
      // This is only the isolated test DB; restore the grant in finally.
      await db.query("revoke select on public.media_assets from authenticated");
      const denied = await fetch(`${appBase()}/api/media/unpublish`, jsonRequest(cookie, {itemId}));
      expect(denied.status).toBe(500);
      const flag = await owner.client.from("portfolio_items").select("published").eq("id", itemId).single();
      expect(flag.data?.published).toBe(true);
      expect((await fetch(`${stackConfig().url}/storage/v1/object/public/media/${publicPaths[0]}`)).status).toBe(200);
    } finally {
      await db.query("grant select on public.media_assets to authenticated"); await db.end();
    }
  });
});
