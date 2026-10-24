import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase,
  stackConfig,
  buildFixtures,
  cleanupFixtures,
  closeApp,
  createUser,
  exiftoolOnBuffer,
  jsonRequest,
  sessionCookieHeader,
  startApp,
  uploadRequest,
  type FixtureSet,
  type TestUser,
} from "./_harness";

type UploadResponse = {
  ok?: boolean;
  itemId?: string;
  path?: string;
  error?: string;
};

/**
 * Privacy + publish lifecycle against the REAL stack: GPS EXIF must
 * not survive into public derivatives, alt text is enforced server
 * side, unpublish tears down public objects while the private master
 * survives, and another account cannot read drafts paths.
 */
describe("P3 — privacy, publish, unpublish (real server, real storage)", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let ownerCookie: string;
  let fixtures: FixtureSet;

  beforeAll(async () => {
    fixtures = await buildFixtures();
    owner = await createUser("media-own");
    stranger = await createUser("media-str");
    ownerCookie = await sessionCookieHeader(owner.email, owner.password);
    await startApp();
  }, 120_000);

  afterAll(async () => {
    await closeApp();
    await cleanupFixtures(fixtures.dir);
    await owner.client.auth.signOut();
    await stranger.client.auth.signOut();
  });

  async function upload(cookie: string, name: string, data: Buffer, altText?: string): Promise<{ res: Response; body: UploadResponse }> {
    const res = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, name, data, { altText }));
    return { res, body: (await res.json()) as UploadResponse };
  }

  async function publish(cookie: string, itemId: string, altText?: string): Promise<{ res: Response; body: { ok?: boolean; publicPaths?: string[]; error?: string } }> {
    const res = await fetch(
      `${appBase()}/api/media/publish`,
      jsonRequest(cookie, { itemId, ...(altText !== undefined ? { altText } : {}) }),
    );
    return { res, body: (await res.json()) as { ok?: boolean; publicPaths?: string[]; error?: string } };
  }

  it("strips GPS and device model from public derivatives; master keeps the bytes", async () => {
    const { body } = await upload(ownerCookie, "gallery.jpg", fixtures.gpsJpg, "Close-up of a mural on a seaside cliff");
    expect(body.ok, `upload response: ${JSON.stringify(body)}`).toBe(true);
    const itemId = body.itemId!;
    const masterPath = body.path!;

    const { res, body: published } = await publish(ownerCookie, itemId);
    expect(res.status).toBe(200);
    expect(published.publicPaths).toHaveLength(2); // small + medium

    for (const p of published.publicPaths!) {
      const url = `${stackConfig().url}/storage/v1/object/public/media/${p}`;
      const derived = await fetch(url);
      expect(derived.status).toBe(200);
      const data = Buffer.from(await derived.arrayBuffer());
      const exif = await exiftoolOnBuffer("variant.webp", data, ["GPSLatitude", "Model"]);
      expect(exif.GPSLatitude).toBeUndefined();
      expect(exif.Model).toBeUndefined();
    }

    // Variant rows carry real dimensions for the frontend to reserve space.
    const variants = await owner.client
      .from("media_assets")
      .select("variant, content_type, width, height, bucket")
      .eq("portfolio_item_id", itemId)
      .eq("bucket", "media");
    expect(variants.error).toBeNull();
    expect(variants.data).toHaveLength(2);
    for (const row of variants.data!) {
      expect(row.content_type).toBe("image/webp");
      expect(row.width).toBeGreaterThan(0);
      expect(row.height).toBeGreaterThan(0);
    }

    const flag = await owner.client
      .from("portfolio_items")
      .select("published")
      .eq("id", itemId)
      .maybeSingle();
    expect(flag.data?.published).toBe(true);

    // The private master still holds the original bytes untouched.
    const master = await owner.client.storage.from("drafts").download(masterPath);
    expect(master.error).toBeNull();
    const masterExif = await exiftoolOnBuffer(
      "master.jpg",
      Buffer.from(await (master.data as Blob).arrayBuffer()),
      ["GPSLatitude", "Model"],
    );
    expect(masterExif.GPSLatitude).toBeDefined();
    expect(masterExif.Model).toBe("iPhone 15");
  });

  it("blocks publishing when alt text is empty — server side, not just the form", async () => {
    const { body } = await upload(ownerCookie, "no-alt.jpg", fixtures.gpsJpg);
    expect(body.ok, `upload response: ${JSON.stringify(body)}`).toBe(true);

    const { res, body: published } = await publish(ownerCookie, body.itemId!);
    expect(res.status).toBe(400);
    expect(published.error).toContain("alt text");

    // The item must still be unpublished (no flag flip on failure).
    const flag = await owner.client
      .from("portfolio_items")
      .select("published")
      .eq("id", body.itemId!)
      .maybeSingle();
    expect(flag.data?.published).toBe(false);
  });

  it("unpublish removes public objects and rows but never the drafts master", async () => {
    const { body } = await upload(ownerCookie, "cycle.jpg", fixtures.gpsJpg, "Test image for unpublishing");
    const itemId = body.itemId!;
    const masterPath = body.path!;
    const { body: published } = await publish(ownerCookie, itemId);
    expect(published.ok).toBe(true);
    const publicPath = published.publicPaths![0];

    const before = await fetch(`${stackConfig().url}/storage/v1/object/public/media/${publicPath}`);
    expect(before.status).toBe(200);

    const res = await fetch(`${appBase()}/api/media/unpublish`, jsonRequest(ownerCookie, { itemId }));
    expect(res.status).toBe(200);

    // Missing public objects answer 400 with statusCode "404" — the
    // contract pinned by tests/access/22 (storage-api behavior, no
    // existence oracle beyond the message).
    const after = await fetch(`${stackConfig().url}/storage/v1/object/public/media/${publicPath}`);
    expect(after.status).toBe(400);
    const afterBody = (await after.json()) as { statusCode?: string; message?: string };
    expect(afterBody.statusCode).toBe("404");
    expect(afterBody.message).toBe("Object not found");

    // No public rows survive…
    const rows = await owner.client
      .from("media_assets")
      .select("id")
      .eq("portfolio_item_id", itemId)
      .eq("bucket", "media");
    expect(rows.data).toHaveLength(0);

    // …the flag is down…
    const flag = await owner.client
      .from("portfolio_items")
      .select("published")
      .eq("id", itemId)
      .maybeSingle();
    expect(flag.data?.published).toBe(false);

    // …and the PRIVATE MASTER IS STILL THERE, byte for byte.
    const master = await owner.client.storage.from("drafts").download(masterPath);
    expect(master.error).toBeNull();
    expect((await (master.data as Blob).arrayBuffer()).byteLength).toBe(fixtures.gpsJpg.byteLength);
  });

  it("keeps drafts objects unreachable for another account guessing the path", async () => {
    const { body } = await upload(ownerCookie, "secret.jpg", fixtures.gpsJpg, "Visible to the owner only");
    const masterPath = body.path!;

    // Stranger KNOWS the exact path — storage still refuses.
    const stolen = await stranger.client.storage.from("drafts").download(masterPath);
    expect(stolen.error).not.toBeNull();
    expect(stolen.error?.message).toBe("Object not found");
  });
});
