import { afterAll, beforeAll, expect, test } from "vitest";
import {
  appBase, buildFixtures, cleanupFixtures, createUser, exiftoolOnBuffer,
  sessionCookieHeader, stackConfig, startApp, type FixtureSet, type TestUser,
} from "../media/_harness";
import { apiCall } from "./_http";

/**
 * Cover pipeline integration (E3). Exercises the REAL routes: bounded
 * upload gate, byte sniffing, actual decode, metadata-stripped WebP
 * derivative landing in the PUBLIC covers bucket, and caller-scoped
 * cleanup only — a member never removes another member's object.
 */

let host: TestUser;
let collab: TestUser;
let stranger: TestUser;
let hostCookie = "";
let collabCookie = "";
let strangerCookie = "";
let collabHandle = "";
let eventId = "";
let fixtures: FixtureSet;
let app: { close: () => Promise<void> } | null = null;

function coverUrl(path: string): string {
  const { url } = stackConfig();
  return `${url}/storage/v1/object/public/covers/${path}`;
}

async function uploadCover(
  cookie: string,
  data: Buffer,
  name: string,
  opts: { origin?: string } = {},
): Promise<{ status: number; json: { error?: string; coverPath?: string; publicUrl?: string; coverIsPublic?: boolean; cleanupPending?: boolean } | null }> {
  const form = new FormData();
  // Declared type is a lie the server must see through: always jpeg.
  form.append("file", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), name);
  const response = await fetch(`${appBase()}/api/events/${eventId}/cover`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin: opts.origin ?? appBase() },
    body: form,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function removeCover(cookie: string): Promise<number> {
  const response = await fetch(`${appBase()}/api/events/${eventId}/cover`, {
    method: "DELETE",
    redirect: "manual",
    headers: { cookie, origin: appBase() },
  });
  return response.status;
}

async function readCoverPath(): Promise<string | null> {
  const { data, error } = await host.client.from("events").select("cover_path").eq("id", eventId).single();
  expect(error).toBeNull();
  return (data as { cover_path: string | null }).cover_path;
}

beforeAll(async () => {
  app = await startApp();
  fixtures = await buildFixtures();
  host = await createUser("events-cover-host");
  collab = await createUser("events-cover-collab");
  stranger = await createUser("events-cover-stranger");
  hostCookie = await sessionCookieHeader(host.email, host.password);
  collabCookie = await sessionCookieHeader(collab.email, collab.password);
  strangerCookie = await sessionCookieHeader(stranger.email, stranger.password);
  const profiles = await Promise.all([host, collab, stranger].map(
    (user) => user.client.from("profiles")
      .update({ published: true, category_id: 1, account_kind: "individual" })
      .eq("id", user.userId).select("handle").single(),
  ));
  for (const profile of profiles) {
    expect(profile.error).toBeNull();
    expect(profile.data).not.toBeNull();
  }
  collabHandle = profiles[1].data?.handle ?? "";

  const created = await apiCall("POST", "/api/events", {
    cookie: hostCookie,
    body: {
      title: "Cover Lab", location: "Gouger Street",
      starts_at: "2026-11-28T10:00:00+10:30",
    },
  });
  expect(created.status).toBe(201);
  eventId = String(created.json?.event?.id);
  const added = await apiCall("POST", `/api/events/${eventId}/collaborators`, {
    cookie: hostCookie, body: { handle: collabHandle },
  });
  expect(added.status).toBe(201);
}, 600_000);

afterAll(async () => {
  if (fixtures) await cleanupFixtures(fixtures.dir);
  if (app) await app.close();
  app = null;
});

let hostPathA = "";
let collabPathB = "";
let hostPathC = "";

test("the host uploads a cover: decoded WebP, no metadata, public immediately", async () => {
  const uploaded = await uploadCover(hostCookie, fixtures.gpsJpg, "field-trip.jpg");
  expect(uploaded.status).toBe(200);
  hostPathA = uploaded.json?.coverPath ?? "";
  expect(hostPathA.startsWith(`${host.userId}/`)).toBe(true);
  expect(uploaded.json?.coverIsPublic).toBe(true);
  expect(await readCoverPath()).toBe(hostPathA);

  // The event is still a DRAFT, yet the disclosed public object serves
  // anonymous readers — this is why the UI warns BEFORE uploading.
  const anon = await fetch(coverUrl(hostPathA));
  expect(anon.status).toBe(200);
  expect(anon.headers.get("content-type") ?? "").toContain("webp");

  // Privacy boundary: the fixture JPEG carries GPS + device model; the
  // stored derivative must carry neither, and it is the resized WebP.
  const bytes = Buffer.from(await anon.arrayBuffer());
  const tags = await exiftoolOnBuffer("stored.webp", bytes, ["GPSLatitude", "Model", "ImageWidth"]);
  expect(tags.GPSLatitude ?? "").toBe("");
  expect(tags.Model ?? "").toBe("");
  expect(Number(tags.ImageWidth)).toBeGreaterThan(0);
  expect(Number(tags.ImageWidth)).toBeLessThanOrEqual(1080);
});

test("a collaborator may set the cover; the previous object is left alone", async () => {
  const uploaded = await uploadCover(collabCookie, fixtures.gpsJpg, "collab-cover.jpg");
  expect(uploaded.status).toBe(200);
  collabPathB = uploaded.json?.coverPath ?? "";
  expect(collabPathB.startsWith(`${collab.userId}/`)).toBe(true);
  expect(await readCoverPath()).toBe(collabPathB);
  // No privileged delete: A lives under the HOST's folder, so the
  // collaborator's cleanup skipped it.
  expect((await fetch(coverUrl(hostPathA))).status).toBe(200);
});

test("the host re-uploads; the collaborator's object is not privilege-deleted", async () => {
  const uploaded = await uploadCover(hostCookie, fixtures.gpsJpg, "second-host.jpg");
  expect(uploaded.status).toBe(200);
  hostPathC = uploaded.json?.coverPath ?? "";
  expect(await readCoverPath()).toBe(hostPathC);
  expect((await fetch(coverUrl(collabPathB))).status).toBe(200);
});

test("a collaborator removing the cover keeps the host's object in place", async () => {
  const removed = await removeCover(collabCookie);
  expect(removed).toBe(200);
  expect(await readCoverPath()).toBeNull();
  // C is under the host's folder — the collaborator cannot delete it.
  expect((await fetch(coverUrl(hostPathC))).status).toBe(200);
});

test("the owner-scoped remove path deletes the caller's own object", async () => {
  const uploaded = await uploadCover(hostCookie, fixtures.gpsJpg, "host-final.jpg");
  expect(uploaded.status).toBe(200);
  const hostPathD = uploaded.json?.coverPath ?? "";
  const removed = await removeCover(hostCookie);
  expect(removed).toBe(200);
  expect(await readCoverPath()).toBeNull();
  // The GoTrue/Storage API on the local stack answers a missing public
  // object with 400 NoSuchKey rather than 404; either way no bytes.
  const goneStatus = (await fetch(coverUrl(hostPathD))).status;
  expect([400, 404], `deleted cover still served (status ${goneStatus})`).toContain(goneStatus);
  // And the earlier host object (A, never referenced again) is
  // untouched by any of this — cleanup is strictly last-replaced.
  expect((await fetch(coverUrl(hostPathA))).status).toBe(200);
});

test("strangers, anonymous, cross-origin, fake and oversized uploads are refused", async () => {
  const before = await readCoverPath();
  expect(before).toBeNull();

  const strangerTry = await uploadCover(strangerCookie, fixtures.gpsJpg, "not-yours.jpg");
  expect(strangerTry.status).toBe(404);
  expect(strangerTry.json?.error).toContain("not a collaborator");

  const anonTry = await fetch(`${appBase()}/api/events/${eventId}/cover`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: appBase() },
    body: (() => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(fixtures.gpsJpg)], { type: "image/jpeg" }), "anon.jpg");
      return form;
    })(),
  });
  expect(anonTry.status).toBe(401);

  const csrfTry = await uploadCover(hostCookie, fixtures.gpsJpg, "csrf.jpg", { origin: "https://evil.example" });
  expect(csrfTry.status).toBe(403);

  const pdfTry = await uploadCover(hostCookie, fixtures.pdfRenamedJpg, "poster.jpg");
  expect(pdfTry.status).toBe(400);
  expect(pdfTry.json?.error ?? "").not.toMatch(/violates|permission denied|constraint|SQL/i);

  const oversizeTry = await uploadCover(hostCookie, fixtures.oversizeJpg, "huge.jpg");
  expect(oversizeTry.status).toBe(413);
  expect(oversizeTry.json?.error ?? "").toContain("4 MiB");

  // None of the rejections touched the row.
  expect(await readCoverPath()).toBeNull();
});

test("bad identifiers fail fast", async () => {
  const response = await fetch(`${appBase()}/api/events/not-a-uuid/cover`, {
    method: "DELETE", redirect: "manual", headers: { cookie: hostCookie, origin: appBase() },
  });
  expect(response.status).toBe(400);
  const gone = await apiCall("DELETE", `/api/events/${"00000000-0000-4000-8000-000000000000"}/cover`, {
    cookie: hostCookie,
  });
  expect(gone.status).toBe(404);
});
