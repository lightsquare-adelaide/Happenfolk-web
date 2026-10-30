import { afterAll, beforeAll, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin } from "../access/_harness";
import {
  createUser, sessionCookieHeader, stackConfig, startApp, type TestUser,
} from "../media/_harness";
import { apiCall as call } from "./_http";

let host: TestUser;
let collab: TestUser;
let stranger: TestUser;
let hostCookie = "";
let collabCookie = "";
let strangerCookie = "";
let hostHandle = "";
let collabHandle = "";
let strangerHandle = "";
let eventId = "";
let bareEventId = "";
let app: { close: () => Promise<void> } | null = null;

/**
 * Real-stack API integration for events S5: every call goes through the
 * real Next server, real auth cookies, and RLS. Authorization is never
 * mocked; denials are asserted by DATA STATE (read-back), not just
 * status codes.
 */

async function readEvent(client = host.client, id = eventId) {
  const { data, error } = await client.from("events")
    .select("id, title, location, status, host_id, price_cents, starts_at")
    .eq("id", id)
    .maybeSingle();
  expect(error).toBeNull();
  return data as {
    id: string; title: string; location: string | null; status: string;
    host_id: string; price_cents: number; starts_at: string;
  } | null;
}

async function roster(client = host.client) {
  const { data, error } = await client.from("event_collaborators")
    .select("profile_id, role")
    .eq("event_id", eventId);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  app = await startApp();
  host = await createUser("events-api-host");
  collab = await createUser("events-api-collab");
  stranger = await createUser("events-api-stranger");
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
  hostHandle = profiles[0].data?.handle ?? "";
  collabHandle = profiles[1].data?.handle ?? "";
  strangerHandle = profiles[2].data?.handle ?? "";
  expect(hostHandle).not.toBe("");
  expect(collabHandle).not.toBe("");
  expect(strangerHandle).not.toBe("");
}, 600_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

test("the organiser creates a zero-price draft with location", async () => {
  const created = await call("POST", "/api/events", {
    cookie: hostCookie,
    body: {
      title: "Salon des Arts",
      location: "Adelaide Town Hall",
      starts_at: "2026-11-14T08:00:00+10:30",
      ends_at: "2026-11-14T14:00:00+10:30",
      description: "A market for contemporary makers.",
    },
  });
  expect(created.status).toBe(201);
  eventId = String(created.json?.event?.id);
  expect(eventId).not.toBe("undefined");

  const row = await readEvent();
  expect(row).not.toBeNull();
  expect(row!.status).toBe("draft");
  expect(row!.host_id).toBe(host.userId);
  expect(row!.price_cents).toBe(0);
  expect(row!.location).toBe("Adelaide Town Hall");

  // The 0005 trigger put the creator on the roster as host.
  const rows = await roster();
  expect(rows).toHaveLength(1);
  expect(rows[0].profile_id).toBe(host.userId);
  expect(rows[0].role).toBe("host");
});

test("the host adds a collaborator by handle", async () => {
  const added = await call("POST", `/api/events/${eventId}/collaborators`, {
    cookie: hostCookie, body: { handle: collabHandle },
  });
  expect(added.status).toBe(201);
  const rows = await roster();
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.profile_id)).toContain(collab.userId);
});

test("a collaborator edits title and location", async () => {
  const edited = await call("PATCH", `/api/events/${eventId}`, {
    cookie: collabCookie,
    body: { title: "Salon des Arts — Late Edition", location: "Adelaide Convention Centre" },
  });
  expect(edited.status).toBe(200);
  const row = await readEvent();
  expect(row!.title).toBe("Salon des Arts — Late Edition");
  expect(row!.location).toBe("Adelaide Convention Centre");
});

test("strangers and anonymous callers cannot edit, and denial changes nothing", async () => {
  const strangerEdit = await call("PATCH", `/api/events/${eventId}`, {
    cookie: strangerCookie, body: { title: "Hijacked" },
  });
  expect(strangerEdit.status).toBe(404);
  const anonEdit = await call("PATCH", `/api/events/${eventId}`, { body: { title: "Hijacked" } });
  expect(anonEdit.status).toBe(401);
  const row = await readEvent();
  expect(row!.title).toBe("Salon des Arts — Late Edition");
});

test("cross-origin browser mutations are refused before any side effect", async () => {
  const evil = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { title: "CSRF Attempt" }, origin: "https://evil.example",
  });
  expect(evil.status).toBe(403);
  const crossSite = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { title: "CSRF Attempt" }, secFetchSite: "cross-site",
  });
  expect(crossSite.status).toBe(403);
  const row = await readEvent();
  expect(row!.title).toBe("Salon des Arts — Late Edition");
});

test("host takeover through the API fails at both layers", async () => {
  // Layer 1: the field allowlist names and rejects host_id.
  const attempt = await call("PATCH", `/api/events/${eventId}`, {
    cookie: collabCookie, body: { host_id: collab.userId },
  });
  expect(attempt.status).toBe(400);
  expect(attempt.json?.error).toBe("Unsupported field: host_id");

  // Layer 2: RLS column grants / trigger — even a raw update through
  // the REST surface must not move host_id.
  const raw = await collab.client.from("events").update({ host_id: collab.userId }).eq("id", eventId);
  expect(raw.error).not.toBeNull();
  const row = await readEvent();
  expect(row!.host_id).toBe(host.userId);
});

test("ordinary collaborators cannot delete the event", async () => {
  const denied = await call("DELETE", `/api/events/${eventId}`, { cookie: collabCookie });
  expect(denied.status).toBe(404);
  expect(await readEvent()).not.toBeNull();
});

test("publishing requires a location and the state machine stays linear", async () => {
  // A pre-existing row without location (column added by 20261026000700):
  // inserting through RLS without location is possible, publishing is not.
  const inserted = await host.client.from("events").insert({
    host_id: host.userId, title: "No Location Yet", status: "draft",
    starts_at: "2026-12-01T09:00:00+10:30",
  }).select("id").single();
  expect(inserted.error).toBeNull();
  bareEventId = String(inserted.data!.id);

  const tooEarly = await call("PATCH", `/api/events/${bareEventId}`, {
    cookie: hostCookie, body: { status: "cancelled" },
  });
  expect(tooEarly.status).toBe(400);
  expect(tooEarly.json?.error).toContain("cannot be cancelled directly");

  const blocked = await call("PATCH", `/api/events/${bareEventId}`, {
    cookie: hostCookie, body: { status: "published" },
  });
  expect(blocked.status).toBe(400);
  expect(blocked.json?.error).toContain("location");

  const fixed = await call("PATCH", `/api/events/${bareEventId}`, {
    cookie: hostCookie, body: { location: "North Terrace" },
  });
  expect(fixed.status).toBe(200);
  const barePublished = await call("PATCH", `/api/events/${bareEventId}`, {
    cookie: hostCookie, body: { status: "published" },
  });
  expect(barePublished.status).toBe(200);

  // draft -> published is legal and collaborators may publish.
  const published = await call("PATCH", `/api/events/${eventId}`, {
    cookie: collabCookie, body: { status: "published" },
  });
  expect(published.status).toBe(200);

  // Repeated publish is an idempotent 200 with the current event, not
  // a "No fields to update" 400 (leader-repro 26 Oct).
  const republish = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "published" },
  });
  expect(republish.status).toBe(200);
  expect(republish.json?.event?.status).toBe("published");

  const backToDraft = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "draft" },
  });
  expect(backToDraft.status).toBe(400);

  const cancelled = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "cancelled" },
  });
  expect(cancelled.status).toBe(200);
  const recancel = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "cancelled" },
  });
  expect(recancel.status).toBe(200);
  expect(recancel.json?.event?.status).toBe("cancelled");
  const republished = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "published" },
  });
  expect(republished.status).toBe(400);
  expect(republished.json?.error).toContain("cannot be republished");
});

test("a same-status repeat must not touch the version column", async () => {
  // The repeat publish above took the no-write path: updated_at (the
  // optimistic-concurrency token) may only move with a real write.
  const before = await host.client.from("events").select("updated_at").eq("id", eventId).single();
  expect(before.error).toBeNull();
  const repeated = await call("PATCH", `/api/events/${eventId}`, {
    cookie: hostCookie, body: { status: "cancelled" },
  });
  expect(repeated.status).toBe(200);
  const after = await host.client.from("events").select("updated_at").eq("id", eventId).single();
  expect(String(after.data?.updated_at)).toBe(String(before.data?.updated_at));
});

test("published is world-readable and drafts are not", async () => {
  const { url, anonKey } = stackConfig();
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  // Published (the bare-location event) is visible to anonymous readers.
  const published = await anon.from("events").select("id, status")
    .eq("id", bareEventId).maybeSingle();
  expect(published.data?.status).toBe("published");

  // Cancelled is no longer published — it vanishes for anon.
  const cancelledVisible = await anon.from("events")
    .select("id, status").eq("id", eventId).maybeSingle();
  expect(cancelledVisible.data).toBeNull();

  // A fresh draft stays invisible to anon but visible to its host.
  const draft = await host.client.from("events").insert({
    host_id: host.userId, title: "Hidden Draft", location: "Stub Street",
    status: "draft", starts_at: "2026-12-02T09:00:00+10:30",
  }).select("id").single();
  expect(draft.error).toBeNull();
  const draftId = String(draft.data!.id);
  const anonSeesDraft = await anon.from("events").select("id").eq("id", draftId).maybeSingle();
  expect(anonSeesDraft.data).toBeNull();
  const hostSeesDraft = await host.client.from("events").select("id").eq("id", draftId).maybeSingle();
  expect(hostSeesDraft.data).not.toBeNull();
});

test("roster management is host-only", async () => {
  const denied = await call("POST", `/api/events/${eventId}/collaborators`, {
    cookie: collabCookie, body: { handle: strangerHandle },
  });
  expect(denied.status).toBe(404);
  const rows = await roster();
  expect(rows).toHaveLength(2);

  const selfRemove = await call("DELETE", `/api/events/${eventId}/collaborators`, {
    cookie: hostCookie, body: { profileId: host.userId },
  });
  expect(selfRemove.status).toBe(409);
  expect(selfRemove.json?.error).toContain("At least one organiser must remain");

  const notOnRoster = await call("DELETE", `/api/events/${eventId}/collaborators`, {
    cookie: hostCookie, body: { profileId: stranger.userId },
  });
  expect(notOnRoster.status).toBe(404);

  const removed = await call("DELETE", `/api/events/${eventId}/collaborators`, {
    cookie: hostCookie, body: { profileId: collab.userId },
  });
  expect(removed.status).toBe(200);

  // Access really ended: the former collaborator can no longer edit.
  const afterRemoval = await call("PATCH", `/api/events/${eventId}`, {
    cookie: collabCookie, body: { title: "After Removal" },
  });
  expect(afterRemoval.status).toBe(404);
  const row = await readEvent();
  expect(row!.title).toBe("Salon des Arts — Late Edition");
});

test("the organiser deletes the event and the roster follows", async () => {
  const denied = await call("DELETE", `/api/events/${eventId}`, { cookie: strangerCookie });
  expect(denied.status).toBe(404);

  const deleted = await call("DELETE", `/api/events/${eventId}`, { cookie: hostCookie });
  expect(deleted.status).toBe(200);
  expect(await readEvent()).toBeNull();

  // Cascade deletion passes the last-host guard (tests/events/02 pins
  // the trigger path; this pins the route end to end).
  const a = await admin();
  const left = await a.query(
    "select count(*)::int as n from public.event_collaborators where event_id = $1", [eventId],
  );
  expect(left.rows[0].n).toBe(0);
});
