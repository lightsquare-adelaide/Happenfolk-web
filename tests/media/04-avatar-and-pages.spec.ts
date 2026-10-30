import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appBase, buildFixtures, cleanupFixtures, closeApp, createUser, sessionCookieHeader, stackConfig, startApp, uploadRequest, jsonRequest, type FixtureSet, type TestUser } from "./_harness";

describe("profile and artist media adapter", () => {
  let owner: TestUser, cookie: string, fixtures: FixtureSet;
  beforeAll(async () => {
    fixtures = await buildFixtures(); owner = await createUser("media-profile");
    await owner.client.from("profiles").update({ category_id: 1, published: true }).eq("id", owner.userId);
    cookie = await sessionCookieHeader(owner.email, owner.password); await startApp();
  }, 300_000);
  afterAll(async () => {
    // The public-artist-page fixture flips profiles.published, which the
    // anon-visible RLS policy then exposes. Unpublish it again so any
    // suite that runs after this one (locally there is no per-suite db
    // reset; CI orders test:auth before test:media) still sees a database
    // where anonymous profile dumps return zero rows.
    if (owner) {
      const { error } = await owner.client
        .from("profiles")
        .update({ published: false })
        .eq("id", owner.userId);
      expect(error).toBeNull();
    }
    await closeApp();
    if (fixtures) await cleanupFixtures(fixtures.dir);
  });

  it("uploads an optimised avatar to the caller profile and rejects anonymous/video uploads", async () => {
    const anonymous = await fetch(`${appBase()}/api/media/avatar`, uploadRequest("", "avatar.jpg", fixtures.gpsJpg));
    expect(anonymous.status).toBe(401);
    const video = await fetch(`${appBase()}/api/media/avatar`, uploadRequest(cookie, "avatar.mp4", fixtures.h264Mp4));
    expect(video.status).toBe(400);
    const response = await fetch(`${appBase()}/api/media/avatar`, uploadRequest(cookie, "avatar.jpg", fixtures.gpsJpg));
    expect(response.status).toBe(201);
    const { path } = await response.json() as { path: string };
    expect(path).toMatch(new RegExp(`^${owner.userId}/[a-z0-9-]+\\.webp$`));
    const profile = await owner.client.from("profiles").select("avatar_path").eq("id", owner.userId).single();
    expect(profile.data?.avatar_path).toBe(path);
    const publicObject = await fetch(`${stackConfig().url}/storage/v1/object/public/avatars/${path}`);
    expect(publicObject.status).toBe(200); expect(publicObject.headers.get("content-type")).toContain("webp");
    const page = await fetch(`${appBase()}/dashboard/profile`, { headers: { cookie } });
    expect(await page.text()).toContain("Upload avatar");
  });

  it("mounts media manager and shows only published media on the team artist route", async () => {
    const dashboard = await fetch(`${appBase()}/dashboard/media`, { headers: { cookie } });
    expect(dashboard.status).toBe(200); expect(await dashboard.text()).toContain("Media management");
    const uploaded = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "work.jpg", fixtures.gpsJpg, { altText: "Adapter visible artwork" }));
    const { itemId } = await uploaded.json() as { itemId: string };
    const profile = await owner.client.from("profiles").select("handle").eq("id", owner.userId).single();
    const url = `${appBase()}/artists/${profile.data!.handle}`;
    expect(await (await fetch(url)).text()).not.toContain("Adapter visible artwork");
    expect((await fetch(`${appBase()}/api/media/publish`, jsonRequest(cookie, { itemId }))).status).toBe(200);
    expect(await (await fetch(url)).text()).toContain("Adapter visible artwork");
    expect((await fetch(`${appBase()}/api/media/unpublish`, jsonRequest(cookie, { itemId }))).status).toBe(200);
    expect(await (await fetch(url)).text()).not.toContain("Adapter visible artwork");
  });
  it("serializes concurrent avatar replacement without orphan public objects", async () => {
    const options = () => uploadRequest(cookie, "avatar.jpg", fixtures.gpsJpg);
    const responses = await Promise.all([fetch(`${appBase()}/api/media/avatar`, options()), fetch(`${appBase()}/api/media/avatar`, options())]);
    expect(responses.map(response => response.status).every(status => status === 201 || status === 409)).toBe(true);
    const objects = await owner.client.storage.from("avatars").list(owner.userId);
    expect(objects.data).toHaveLength(1);
  });

});
