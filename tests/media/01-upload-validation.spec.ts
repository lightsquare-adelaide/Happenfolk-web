import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appBase,
  buildFixtures,
  cleanupFixtures,
  createUser,
  sessionCookieHeader,
  closeApp,
  startApp,
  uploadRequest,
  type FixtureSet,
  type TestUser,
} from "./_harness";

/**
 * Upload gate against the REAL Next server and REAL storage RLS.
 * Every fixture is synthesized (ffmpeg/exiftool) and every declared
 * Content-Type is deliberately wrong — the server must sniff bytes.
 */
describe("P3 — upload validation (real server, real storage)", () => {
  let user: TestUser;
  let cookie: string;
  let fixtures: FixtureSet;

  beforeAll(async () => {
    fixtures = await buildFixtures();
    user = await createUser("media-val");
    cookie = await sessionCookieHeader(user.email, user.password);
    await startApp();
  }, 120_000);

  afterAll(async () => {
    await closeApp();
    await cleanupFixtures(fixtures.dir);
    await user.client.auth.signOut();
  });

  it("accepts H.264 .mp4 (moov at EOF) and stores the master in drafts", async () => {
    const res = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "cat.mp4", fixtures.h264Mp4));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      itemId: string;
      path: string;
      contentType: string;
      width: number | null;
      height: number | null;
    };
    expect(body.ok).toBe(true);
    expect(body.contentType).toBe("video/mp4");
    expect(body.width).toBe(640);
    expect(body.height).toBe(480);
    // Safe path: uid-prefixed, uuid name, no user-controlled segment.
    expect(body.path).toMatch(new RegExp(`^${user.userId}/[0-9a-f-]{36}\\.mp4$`));

    // The master must really sit in the PRIVATE drafts bucket.
    const master = await user.client.storage.from("drafts").download(body.path);
    expect(master.error).toBeNull();
    const bytes = new Uint8Array(await (master.data as Blob).arrayBuffer());
    expect(bytes.byteLength).toBe(fixtures.h264Mp4.byteLength);

    // And the pipeline must have provisioned the draft item it hangs on.
    const item = await user.client
      .from("portfolio_items")
      .select("id, media_kind, published")
      .eq("id", body.itemId)
      .maybeSingle();
    expect(item.data).not.toBeNull();
    expect(item.data?.media_kind).toBe("video");
    expect(item.data?.published).toBe(false);
  });

  it("rejects a PDF renamed to .jpg despite the image Content-Type", async () => {
    const res = await fetch(
      `${appBase()}/api/media/upload`,
      uploadRequest(cookie, "nice-photo.jpg", fixtures.pdfRenamedJpg),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("supported");
  });

  it("rejects HEVC .mov and tells the user how to export H.264", async () => {
    const res = await fetch(
      `${appBase()}/api/media/upload`,
      uploadRequest(cookie, "iphone-clip.mov", fixtures.hevcMov),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toContain("HEVC");
    expect(body.hint).toBeTruthy();
    expect(body.hint).toContain("H.264");
    expect(body.hint).toContain("export");
  });

  it("rejects anything above the 4 MiB cap even with valid magic bytes", async () => {
    const res = await fetch(
      `${appBase()}/api/media/upload`,
      uploadRequest(cookie, "huge.jpg", fixtures.oversizeJpg),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("4 MiB");
  });
});
