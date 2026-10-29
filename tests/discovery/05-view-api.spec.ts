import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The primary server this file starts runs in the documented self-hosted
// trusted-proxy mode. Must be set before startApp() spawns `next start`
// (the child inherits this process' environment).
process.env.VIEW_RECORDING_TRUST_FORWARDED_FOR = "1";
delete process.env.VERCEL;

import {
  admin,
  createEvent,
  createPortfolioItem,
  MUSIC,
  publishProfile,
} from "./_harness";
import {
  createUser,
  sessionCookieHeader,
  type TestUser,
} from "../auth/_harness";

/**
 * S2 — view recording through the ACTUAL /api/views route: real Next
 * server, real PostgREST identity forwarding, real page_views rows.
 * A direct-Supabase RPC test cannot see any of this route's failure
 * modes (lost visitor headers would collapse every anonymous visitor
 * behind the server's one SDK fingerprint; the untrusted-mode skip and
 * the public-visibility precheck live entirely here).
 *
 * page_views is inspected ONLY through the local admin fixture
 * connection (RLS denies every client by design); nothing here exposes
 * raw rows to a browser-side client.
 *
 * Red case coverage required by the milestone: if the scoped header
 * forwarding were removed, "two anonymous identities with the SAME UA
 * but distinct trusted IPs each increment exactly once" would collapse
 * to a single shared fingerprint and the second view would be deduped
 * away — that spec is the forwarding regression guard.
 */

const runTag = `s2api-${Date.now().toString(36)}`;
const UA_A = `Mozilla/5.0 (X11; Test; ${runTag}) SharedUA`;

let closeApp: (() => Promise<void>) | null = null;

// One isolated app port, including the untrusted-mode check. Never start
// a second stack or borrow another executor's application port.
const PORT = 3102;
const appBase = () => `http://127.0.0.1:${PORT}`;

async function startApp(trusted = true): Promise<{ close: () => Promise<void> }> {
  const root = process.cwd();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.VERCEL;
  if (trusted) env.VIEW_RECORDING_TRUST_FORWARDED_FOR = "1";
  else delete env.VIEW_RECORDING_TRUST_FORWARDED_FOR;
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(PORT),
      "-H",
      "127.0.0.1",
    ],
    { cwd: root, stdio: "ignore", detached: true, env },
  );
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    process.kill(-child.pid!, "SIGTERM");
    await exited;
  };
  const deadline = Date.now() + 30_000;
  try {
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`next start exited early (code ${child.exitCode}) on ${PORT}`);
      }
      if (Date.now() > deadline) throw new Error("next start not ready within 30s");
      try {
        const res = await fetch(appBase(), { redirect: "manual" });
        await res.arrayBuffer();
        if (res.status > 0) return { close };
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (error) {
    await close();
    throw error;
  }
}

function buildWhenStale() {
  const newest = (file: string): number => {
    if (!fs.existsSync(file)) return 0;
    const stat = fs.statSync(file);
    return stat.isDirectory()
      ? Math.max(0, ...fs.readdirSync(file).map((entry) => newest(path.join(file, entry))))
      : stat.mtimeMs;
  };
  const inputs = ["src", "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs", ".env.local"];
  if (newest(".next/BUILD_ID") <= Math.max(...inputs.map(newest))) {
    execSync("nice -n 10 npm run build", {
      stdio: "inherit", env: { ...process.env, NODE_ENV: "production" },
    });
  }
}

// ---------------- fixtures ----------------

let publicArtist: TestUser;
let privateArtist: TestUser;
let member1: TestUser;
let member2: TestUser;
let member1Cookie: string;
let member2Cookie: string;

let publicEventId: string; // per-identity counting subject
let memberEventId: string; // member recording subject
let publicItemId: string; // item of a PUBLIC artist (recordable)
let privateOwnerItemId: string; // PUBLISHED item of a PRIVATE artist (must never record)
let draftItemId: string;
let draftEventId: string;
let cancelledEventId: string;
let publicArtistCookie: string;
let privateArtistCookie: string;

const createdUserIds: string[] = [];
const createdSubjectIds: string[] = [];

async function makeUser(label: string): Promise<TestUser> {
  const user = await createUser(`${label}-${runTag}`);
  createdUserIds.push(user.userId);
  return user;
}

beforeAll(async () => {
  buildWhenStale();
  const app = await startApp();
  closeApp = app.close;

  publicArtist = await makeUser("public-artist");
  privateArtist = await makeUser("private-artist");
  member1 = await makeUser("member-one");
  member2 = await makeUser("member-two");
  await publishProfile(publicArtist, `Public Artist ${runTag}`, MUSIC, true);
  await publishProfile(privateArtist, `Private Artist ${runTag}`, MUSIC, false);

  const ev1 = await createEvent(publicArtist, `View API Event A ${runTag}`, MUSIC, "published", 30);
  const ev2 = await createEvent(publicArtist, `View API Event B ${runTag}`, MUSIC, "published", 31);
  publicEventId = ev1.id;
  memberEventId = ev2.id;
  createdSubjectIds.push(ev1.id, ev2.id);

  const pubItem = await createPortfolioItem(publicArtist, `View API Public Work ${runTag}`, true);
  const privItem = await createPortfolioItem(privateArtist, `View API Hidden Owner Work ${runTag}`, true);
  publicItemId = pubItem.id;
  privateOwnerItemId = privItem.id;
  createdSubjectIds.push(pubItem.id, privItem.id, publicArtist.userId, privateArtist.userId);
  const draftItem = await createPortfolioItem(publicArtist, `Draft Work ${runTag}`, false);
  draftItemId = draftItem.id;
  createdSubjectIds.push(draftItemId);
  for (const status of ["draft", "cancelled"] as const) {
    const event = await createEvent(publicArtist, `${status} Event ${runTag}`, MUSIC, status);
    createdSubjectIds.push(event.id);
    if (status === "draft") draftEventId = event.id;
    else cancelledEventId = event.id;
  }

  member1Cookie = await sessionCookieHeader(member1.email, member1.password);
  member2Cookie = await sessionCookieHeader(member2.email, member2.password);
  publicArtistCookie = await sessionCookieHeader(publicArtist.email, publicArtist.password);
  privateArtistCookie = await sessionCookieHeader(privateArtist.email, privateArtist.password);
}, 240_000);

afterAll(async () => {
  // Cleanup own fixtures only: page_views rows for our subjects, then
  // the accounts (cascading profiles/events/items/media/interactions).
  try {
    const a = await admin();
    if (createdSubjectIds.length > 0) {
      await a.query(`delete from public.page_views where subject_id = any ($1::uuid[])`, [
        createdSubjectIds,
      ]);
    }
    for (const uid of createdUserIds) {
      await a.query(`delete from auth.users where id = $1`, [uid]);
    }
  } finally {
    if (closeApp) await closeApp();
  }
});

// ---------------- helpers ----------------

type ViewRows = { viewer_id: string | null; visitor_hash: string | null }[];

async function viewRowsFor(subjectId: string): Promise<ViewRows> {
  const a = await admin();
  const res = await a.query<{ viewer_id: string | null; visitor_hash: string | null }>(
    `select viewer_id, visitor_hash from public.page_views where subject_id = $1 order by id`,
    [subjectId],
  );
  return res.rows;
}

async function postView(
  base: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}/api/views`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response body
  }
  return { status: res.status, json };
}

function anonHeaders(ip: string | null, ua: string | null = UA_A): Record<string, string> {
  const h: Record<string, string> = {};
  if (ip !== null) h["x-forwarded-for"] = ip;
  if (ua !== null) h["user-agent"] = ua;
  return h;
}

const validBody = (subjectType: string, subjectId: string) => ({ subjectType, subjectId });

// ---------------- specs ----------------

describe("S2 — two anonymous identities, same UA, distinct trusted IPs", () => {
  it("each identity increments exactly once; repeats and concurrent repeats do not inflate", async () => {
    const base = appBase();

    const first = await postView(base, validBody("event", publicEventId), anonHeaders("203.0.113.21"));
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true });
    let rows = await viewRowsFor(publicEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].viewer_id).toBeNull();
    expect(rows[0].visitor_hash).not.toBeNull();

    // THE forwarding regression guard: same UA, different trusted IP is
    // a DIFFERENT visitor. Without scoped header forwarding both calls
    // would share one fingerprint (SDK UA + server context) and the
    // second row would never exist.
    const second = await postView(base, validBody("event", publicEventId), anonHeaders("203.0.113.22"));
    expect(second.json).toMatchObject({ ok: true });
    rows = await viewRowsFor(publicEventId);
    expect(rows).toHaveLength(2);
    const [hashA, hashB] = rows.map((r) => r.visitor_hash);
    expect(hashA).not.toBe(hashB);
    // No raw identity material is persisted.
    for (const row of rows) {
      expect(row.visitor_hash).not.toContain("203.0.113");
      expect(row.visitor_hash).not.toContain("Mozilla");
    }

    // Repeat by the first identity: app-layer throttle (60s window).
    const repeat = await postView(base, validBody("event", publicEventId), anonHeaders("203.0.113.21"));
    expect(repeat.json).toMatchObject({ ok: true, throttled: true });
    rows = await viewRowsFor(publicEventId);
    expect(rows).toHaveLength(2);

    // Concurrent burst from a fresh identity: exactly ONE new row
    // (app throttle is synchronous; DB advisory lock backs it up).
    const [c1, c2] = await Promise.all([
      postView(base, validBody("event", publicEventId), anonHeaders("203.0.113.23")),
      postView(base, validBody("event", publicEventId), anonHeaders("203.0.113.23")),
    ]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    rows = await viewRowsFor(publicEventId);
    expect(rows).toHaveLength(3);
  });
});

describe("S2 — member recording uses the verified auth.uid()", () => {
  it("member1 and member2 each count under their own UID; repeats dedupe in the DB", async () => {
    const base = appBase();

    const r1 = await postView(base, validBody("event", memberEventId), {
      cookie: member1Cookie,
      "user-agent": UA_A,
    });
    expect(r1.json).toMatchObject({ ok: true });
    const r2 = await postView(base, validBody("event", memberEventId), {
      cookie: member2Cookie,
      "user-agent": UA_A,
    });
    expect(r2.json).toMatchObject({ ok: true });

    const rows = await viewRowsFor(memberEventId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.viewer_id).sort()).toEqual(
      [member1.userId, member2.userId].sort(),
    );
    // Members are identified by viewer_id; no anonymous hash is stored.
    expect(rows.every((r) => r.visitor_hash === null)).toBe(true);

    // Repeat by member1: F's 30-minute per-identity DB dedupe.
    const again = await postView(base, validBody("event", memberEventId), {
      cookie: member1Cookie,
      "user-agent": UA_A,
    });
    expect(again.json).toMatchObject({ ok: true });
    expect(await viewRowsFor(memberEventId)).toHaveLength(2);
  });

  it("rejects a caller-selected viewer outright (strict two-key body)", async () => {
    const base = appBase();
    const res = await postView(
      base,
      { subjectType: "event", subjectId: memberEventId, viewerId: member2.userId },
      { cookie: member1Cookie, "user-agent": UA_A },
    );
    expect(res.status).toBe(400);
    // Still exactly member1+member2 rows from the previous spec.
    expect(await viewRowsFor(memberEventId)).toHaveLength(2);
  });
});

describe("S2 — missing trusted identity skips instead of collapsing", () => {
  it("skips anonymous recording with an unusable trusted client IP", async () => {
    // Next supplies the socket peer IP when the header is absent. An
    // explicit empty header exercises missing identity at the route boundary.
    const res = await postView(appBase(), validBody("event", publicEventId), anonHeaders(""));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, skipped: true });
    // Only the three rows from the first spec (21, 22, 23).
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });

  it("skips anonymous recording without a usable original User-Agent", async () => {
    const res = await postView(appBase(), validBody("event", publicEventId), anonHeaders("203.0.113.31", ""));
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, skipped: true });
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });

  it("also skips a raw HTTP request whose User-Agent header is absent", async () => {
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(`${appBase()}/api/views`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.32" },
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      });
      req.on("error", reject);
      req.end(JSON.stringify(validBody("event", publicEventId)));
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, skipped: true });
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });

  it("skips anonymous recording entirely in untrusted mode (no opt-in env)", async () => {
    // Perfect-looking forwarded headers, but the server was started
    // WITHOUT the documented opt-in: nothing may be recorded, and no
    // server-wide fingerprint is invented either.
    await closeApp!();
    const untrusted = await startApp(false);
    closeApp = untrusted.close;
    try {
      const res = await postView(appBase(), validBody("event", publicEventId), anonHeaders("203.0.113.41"));
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ ok: true, skipped: true });
      expect(await viewRowsFor(publicEventId)).toHaveLength(3);
    } finally {
      await untrusted.close();
      closeApp = (await startApp()).close;
    }
    // Restart cleared the in-memory throttle: DB dedupe still prevents
    // two concurrent repeats from adding rows for an existing visitor.
    await Promise.all([
      postView(appBase(), validBody("event", publicEventId), anonHeaders("203.0.113.21")),
      postView(appBase(), validBody("event", publicEventId), anonHeaders("203.0.113.21")),
    ]);
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });
});

describe("S2 — malformed input is rejected without writing", () => {
  it("returns 400 within 2 seconds for a 2 KiB chunked body that never ends", async () => {
    const startedAt = performance.now();
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(`${appBase()}/api/views`, {
        method: "POST",
        headers: { "content-type": "application/json", "transfer-encoding": "chunked" },
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode!, body });
          req.destroy();
        });
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error("no response within 2 seconds for an endless 2 KiB body"));
      }, 2000);
      req.on("error", (error) => { clearTimeout(timer); reject(error); });
      req.write("x".repeat(2048));
      // Deliberately omit req.end(): the server must reject mid-upload.
    });
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ ok: false });
    expect(performance.now() - startedAt).toBeLessThan(2000);
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
    console.log(`endless chunked body: HTTP ${result.status}, ${Math.round(performance.now() - startedAt)} ms`);
  });
  it("400s on malformed JSON, wrong types, extra keys, arrays and oversize bodies", async () => {
    const base = appBase();
    const cases: unknown[] = [
      "{not json",
      validBody("user", publicEventId), // bad subjectType
      validBody("event", "not-a-uuid"), // bad subjectId
      { subjectType: "event" }, // missing key
      { ...validBody("event", publicEventId), extra: 1 }, // extra key
      [validBody("event", publicEventId)], // array body
      42, // scalar body
    ];
    for (const body of cases) {
      const res = await postView(base, body, anonHeaders("203.0.113.51"));
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ ok: false });
    }

    // Oversize body (8 KiB of syntactically valid JSON, over the 1 KiB
    // bound): rejected by the bounded stream reader before parsing; the
    // mid-flight cancel itself is pinned DB-free in
    // src/lib/view-throttle.spec.ts (counting-stream stops early).
    const huge = JSON.stringify({
      subjectType: "event",
      subjectId: publicEventId,
      // keep the two required keys valid; the bulk is NOT an allowed key
      padding: "p".repeat(8 * 1024),
    });
    const hugeRes = await postView(base, huge, anonHeaders("203.0.113.52"));
    expect(hugeRes.status).toBe(400);
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });

  it("403s cross-origin requests without writing", async () => {
    const res = await postView(appBase(), validBody("event", publicEventId), {
      ...anonHeaders("203.0.113.61"),
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ ok: false });
    expect(await viewRowsFor(publicEventId)).toHaveLength(3);
  });
});

describe("S2 — public-subject visibility precheck (before any RPC)", () => {
  it("does not count the viewer's own published profile, including uppercase UUIDs", async () => {
    for (const id of [publicArtist.userId, publicArtist.userId.toUpperCase()]) {
      const before = await viewRowsFor(publicArtist.userId);
      const res = await postView(appBase(), validBody("profile", id), {
        cookie: publicArtistCookie,
        "user-agent": UA_A,
      });
      expect(res.status).toBe(200);
      expect(await viewRowsFor(publicArtist.userId)).toEqual(before);
    }
  });

  it("never records drafts, cancelled events, private profiles or private-owner items for any caller", async () => {
    const subjects = [
      validBody("portfolio_item", draftItemId),
      validBody("event", draftEventId),
      validBody("event", cancelledEventId),
      validBody("profile", privateArtist.userId),
      validBody("portfolio_item", privateOwnerItemId),
    ];
    for (const cookie of ["", member1Cookie, publicArtistCookie, privateArtistCookie]) {
      for (const subject of subjects) {
        const res = await postView(appBase(), subject, {
          ...anonHeaders("203.0.113.99"), ...(cookie ? { cookie } : {}),
        });
        expect(res.status).toBe(200);
        expect(res.json).toEqual({ ok: false });
        expect(await viewRowsFor(subject.subjectId)).toHaveLength(0);
      }
    }
  });

  it("mounts work trackers only when both the profile and the work are published", async () => {
    for (const [artist, cookie, itemId, visible] of [
      [publicArtist, publicArtistCookie, publicItemId, true],
      [privateArtist, privateArtistCookie, privateOwnerItemId, false],
    ] as const) {
      const { data, error } = await artist.client.from("profiles").select("handle").eq("id", artist.userId).single();
      expect(error).toBeNull();
      const res = await fetch(`${appBase()}/artists/${data!.handle}`, { headers: { cookie } });
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html.includes(`data-work-view-sentinel="${itemId}"`)).toBe(visible);
      expect(html).not.toContain(`data-work-view-sentinel="${draftItemId}"`);
    }
  });
  it("anonymous: private profile is not recordable", async () => {
    const res = await postView(appBase(), validBody("profile", privateArtist.userId), anonHeaders("203.0.113.71"));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false });
    expect(await viewRowsFor(privateArtist.userId)).toHaveLength(0);
  });

  it("anonymous: PUBLISHED item of a PRIVATE artist is not recordable", async () => {
    // F's record_page_view alone would accept this (it checks only the
    // item's flag); the route's owner-profile precheck must stop it.
    const res = await postView(appBase(), validBody("portfolio_item", privateOwnerItemId), anonHeaders("203.0.113.72"));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false });
    expect(await viewRowsFor(privateOwnerItemId)).toHaveLength(0);
  });

  it("authenticated owner private preview: own private profile records nothing", async () => {
    const cookie = await sessionCookieHeader(privateArtist.email, privateArtist.password);
    const res = await postView(appBase(), validBody("profile", privateArtist.userId), {
      cookie,
      "user-agent": UA_A,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false });
    expect(await viewRowsFor(privateArtist.userId)).toHaveLength(0);
  });

  it("authenticated owner private preview: own published item under a private profile records nothing", async () => {
    const cookie = await sessionCookieHeader(privateArtist.email, privateArtist.password);
    const res = await postView(appBase(), validBody("portfolio_item", privateOwnerItemId), {
      cookie,
      "user-agent": UA_A,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false });
    expect(await viewRowsFor(privateOwnerItemId)).toHaveLength(0);
  });

  it("unknown ids and private subjects are indistinguishable (no existence leak)", async () => {
    const unknown = await postView(
      appBase(),
      validBody("event", "0e8a1c66-9b04-4f6a-9c8e-2b7a1f0d4c99"),
      anonHeaders("203.0.113.73"),
    );
    const privateSubject = await postView(
      appBase(),
      validBody("profile", privateArtist.userId),
      anonHeaders("203.0.113.74"),
    );
    expect(unknown.status).toBe(200);
    expect(privateSubject.status).toBe(200);
    expect(unknown.json).toEqual(privateSubject.json);
  });

  it("public subjects remain recordable (the precheck is not a blanket deny)", async () => {
    const base = appBase();
    const profileRes = await postView(base, validBody("profile", publicArtist.userId), anonHeaders("203.0.113.81"));
    expect(profileRes.json).toMatchObject({ ok: true });
    expect(await viewRowsFor(publicArtist.userId)).toHaveLength(1);

    const itemRes = await postView(base, validBody("portfolio_item", publicItemId), anonHeaders("203.0.113.82"));
    expect(itemRes.json).toMatchObject({ ok: true });
    expect(await viewRowsFor(publicItemId)).toHaveLength(1);

    for (const [subjectType, subjectId] of [["profile", publicArtist.userId], ["portfolio_item", publicItemId]]) {
      const memberRes = await postView(base, validBody(subjectType, subjectId), { cookie: member1Cookie });
      expect(memberRes.json).toMatchObject({ ok: true });
      const rows = await viewRowsFor(subjectId);
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.viewer_id === member1.userId && row.visitor_hash === null)).toBe(true);
    }
  });
});
