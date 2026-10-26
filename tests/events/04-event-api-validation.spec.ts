import { afterAll, beforeAll, expect, test } from "vitest";
import { createUser, sessionCookieHeader, startApp, type TestUser } from "../media/_harness";
import { apiCall, expectFriendly } from "./_http";

/**
 * Validation matrix for the event API: malformed/null/array bodies,
 * missing and oversized fields, impossible dates, unknown categories,
 * unsupported (takeover/commerce) fields, and bad identifiers. Every
 * rejection must be a friendly message with no database detail.
 */

let host: TestUser;
let hostCookie = "";
let eventId = "";
let app: { close: () => Promise<void> } | null = null;

const VALID_START = "2026-11-20T18:00:00+10:30";

function eventBody(overrides: Record<string, unknown>): Record<string, unknown> {
  return { title: "Drill Hall", location: "Waymouth Street", starts_at: VALID_START, ...overrides };
}

beforeAll(async () => {
  app = await startApp();
  host = await createUser("events-api-validator");
  hostCookie = await sessionCookieHeader(host.email, host.password);
  const created = await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({}) });
  expect(created.status).toBe(201);
  eventId = String(created.json?.event?.id);
}, 600_000);

afterAll(async () => {
  if (app) await app.close();
  app = null;
});

test("POST rejects malformed, null and array JSON bodies", async () => {
  expectFriendly(await apiCall("POST", "/api/events", { cookie: hostCookie, raw: "{ not json" }), 400, "valid JSON");
  expectFriendly(await apiCall("POST", "/api/events", { cookie: hostCookie, raw: "null" }), 400, "JSON object");
  expectFriendly(await apiCall("POST", "/api/events", { cookie: hostCookie, raw: "[]" }), 400, "JSON object");
  expectFriendly(await apiCall("POST", "/api/events", { cookie: hostCookie, raw: '"just a string"' }), 400, "JSON object");
});

test("POST requires name and location and bounds lengths", async () => {
  expectFriendly(await apiCall("POST", "/api/events", { cookie: hostCookie, body: {} }), 400, "Event name is required");
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ title: "   " }) }),
    400, "Event name is required",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ title: 123 }) }),
    400, "Event name must be text",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ title: "x".repeat(121) }) }),
    400, "at most 120 characters",
  );
  const noLocation = eventBody({});
  delete noLocation.location;
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: noLocation }),
    400, "Event location is required",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ location: "x".repeat(201) }) }),
    400, "at most 200 characters",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ description: "x".repeat(5001) }) }),
    400, "at most 5000 characters",
  );
});

test("POST rejects invalid and impossible dates, keeps valid offsets", async () => {
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ starts_at: "2026-11-20T18:00" }) }),
    400, "timezone offset",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ starts_at: "2027-02-30T09:00:00Z" }) }),
    400, "real calendar moment",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ starts_at: "2027-01-01T24:00:00Z" }) }),
    400, "Start: hour must be between 00 and 23",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ starts_at: "not a date" }) }),
    400, "Start:",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", {
      cookie: hostCookie, body: eventBody({ starts_at: VALID_START, ends_at: "2026-11-20T17:00:00+10:30" }),
    }),
    400, "End time cannot be before the start time",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", {
      cookie: hostCookie, body: eventBody({ starts_at: VALID_START, ends_at: "2026-11-21T12:61:00Z" }),
    }),
    400, "End:", "real calendar moment",
  );
  // A winter +09:30 offset (Adelaide outside daylight saving) must pass.
  const winter = await apiCall("POST", "/api/events", {
    cookie: hostCookie, body: eventBody({ starts_at: "2026-07-04T10:00:00+09:30" }),
  });
  expect(winter.status).toBe(201);
});

test("POST rejects bad categories including ids that do not exist", async () => {
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ category_id: "abc" }) }),
    400, "Invalid category",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ category_id: 0 }) }),
    400, "Invalid category",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ category_id: 70000 }) }),
    400, "Invalid category",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ category_id: 30000 }) }),
    400, "Unknown category",
  );
});

test("POST rejects commerce and takeover fields by name", async () => {
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ price_cents: 500 }) }),
    400, "Unsupported field: price_cents",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ host_id: host.userId }) }),
    400, "Unsupported field: host_id",
  );
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({ capacity: 100 }) }),
    400, "Unsupported field: capacity",
  );
});

test("POST denies anonymous and cross-origin callers", async () => {
  expectFriendly(await apiCall("POST", "/api/events", { body: eventBody({}) }), 401, "Sign in first");
  expectFriendly(
    await apiCall("POST", "/api/events", { cookie: hostCookie, body: eventBody({}), origin: "https://evil.example" }),
    403, "Cross-origin",
  );
});

test("PATCH validates body shape against a real event", async () => {
  expectFriendly(await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, raw: "{" }), 400, "valid JSON");
  expectFriendly(await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, raw: "null" }), 400, "JSON object");
  expectFriendly(await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: {} }), 400, "No fields to update");
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { location: null } }),
    400, "Event location is required",
  );
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { status: "archived" } }),
    400, "Unknown event status",
  );
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { status: 5 } }),
    400, "Unknown event status",
  );
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { starts_at: "soon" } }),
    400, "Start:",
  );
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { category_id: 30000 } }),
    400, "Unknown category",
  );
  expectFriendly(
    await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { price_cents: 1 } }),
    400, "Unsupported field: price_cents",
  );
  // Clearing an optional description is a legal edit, not a validation error.
  const cleared = await apiCall("PATCH", `/api/events/${eventId}`, { cookie: hostCookie, body: { description: null } });
  expect(cleared.status).toBe(200);
});

test("bad identifiers fail before any lookup or side effect", async () => {
  expectFriendly(await apiCall("PATCH", "/api/events/not-a-uuid", { cookie: hostCookie, body: { title: "x" } }), 400, "Invalid event identifier");
  expectFriendly(await apiCall("DELETE", "/api/events/not-a-uuid", { cookie: hostCookie }), 400, "Invalid event identifier");
  expectFriendly(
    await apiCall("POST", "/api/events/not-a-uuid/collaborators", { cookie: hostCookie, body: { handle: "someone" } }),
    400, "Invalid event identifier",
  );
});

test("collaborator routes validate their own fields", async () => {
  expectFriendly(
    await apiCall("POST", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, body: { nope: "x" } }),
    400, "Unsupported field: nope",
  );
  expectFriendly(
    await apiCall("POST", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, body: { handle: "   " } }),
    400, "Missing handle",
  );
  expectFriendly(
    await apiCall("POST", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, body: { handle: "x".repeat(31) } }),
    400, "Missing handle",
  );
  expectFriendly(
    await apiCall("POST", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, body: { handle: "nobody-here-xyz" } }),
    404, "No artist with this handle",
  );
  expectFriendly(
    await apiCall("DELETE", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, body: { profileId: "zz" } }),
    400, "Invalid artist identifier",
  );
  expectFriendly(
    await apiCall("DELETE", `/api/events/${eventId}/collaborators`, { cookie: hostCookie, raw: "[]" }),
    400, "JSON object",
  );
});
