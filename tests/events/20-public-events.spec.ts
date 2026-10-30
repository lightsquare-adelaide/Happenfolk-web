import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { appBase, createUser, sessionCookieHeader, startApp, type TestUser } from "../auth/_harness";
import { stackConfig } from "../access/_harness";
import { adelaideWallTimeToInstant, instantToAdelaideWallClock } from "../../src/lib/events";

describe("public event pages on the real stack", () => {
  let host: TestUser;
  let cookie: string;
  let handle: string;
  const ids: string[] = [];
  const names = { published: `Public exhibition ${Date.now()}`, draft: `Private planning ${Date.now()}`, cancelled: `Cancelled exhibition ${Date.now()}` };
  let published: string;
  let draft: string;
  let cancelled: string;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;

  beforeAll(async () => {
    host = await createUser("public-events");
    const profile = await host.client.from("profiles").update({ published: true, category_id: 1, display_name: "Public event organising artist" }).eq("id", host.userId).select("handle").single();
    expect(profile.error).toBeNull();
    handle = profile.data!.handle;
    cookie = await sessionCookieHeader(host.email, host.password);
    // Keep the fixture inside the upcoming directory's first page even
    // when other suites have left published events on the shared stack.
    const now = Date.now();
    let day = instantToAdelaideWallClock(new Date(now).toISOString()).date;
    let start = adelaideWallTimeToInstant(day, "19:00");
    if (start.ok && Date.parse(start.iso) <= now) {
      day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      start = adelaideWallTimeToInstant(day, "19:00");
    }
    if (!start.ok) throw new Error("Could not prepare the Adelaide evening fixture");
    for (const status of ["published", "draft", "cancelled"] as const) {
      const inserted = await host.client.from("events").insert({ host_id: host.userId, title: names[status], location: "Adelaide exhibition space", description: "A public-facing artist exhibition.", starts_at: start.iso, status }).select("id").single();
      expect(inserted.error).toBeNull();
      ids.push(inserted.data!.id);
    }
    [published, draft, cancelled] = ids;
    app = await startApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (host) {
      const admin = new pg.Client({ connectionString: stackConfig().dbUrl });
      await admin.connect();
      try {
        await admin.query("delete from public.events where id = any($1::uuid[])", [ids]);
        await admin.query("delete from auth.users where id = $1", [host.userId]);
      } finally { await admin.end(); }
    }
  });

  test("anonymous directory exposes summaries and time while protecting venues", async () => {
    const response = await fetch(`${appBase()}/events`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(names.published);
    expect(html).not.toContain("Adelaide exhibition space");
    expect(html).toContain("Sign in to see the venue");
    expect(html).toContain("Australia/Adelaide");
    expect(html).not.toContain(names.draft);
    expect(html).not.toContain(names.cancelled);
  });

  test("public directory stays published-only for its host too", async () => {
    const response = await fetch(`${appBase()}/events`, { headers: { cookie } });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(names.published);
    expect(html).not.toContain(names.draft);
    expect(html).not.toContain(names.cancelled);
  });

  test("anonymous detail shows the event and a correctly routed artist link", async () => {
    const response = await fetch(`${appBase()}/events/${published}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(names.published);
    expect(html).not.toContain("Adelaide exhibition space");
    expect(html).toContain("Sign in to see the venue");
    expect(html).not.toContain("A public-facing artist exhibition.");
    expect(html).toContain(`/login?next=${encodeURIComponent(`/events/${published}`)}`);
    expect(html).toContain(`/artists/${handle}`);
    expect(html).toContain("Public event organising artist");
    expect(html).toContain("7:00 pm");
  });

  test("signed-in detail retains the exact venue and full description", async () => {
    const response = await fetch(`${appBase()}/events/${published}`, { headers: { cookie } });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Adelaide exhibition space");
    expect(html).toContain("A public-facing artist exhibition.");
    expect(html).not.toContain("Sign in to see the venue");
  });

  test("anonymous draft and cancelled details are 404", async () => {
    for (const id of [draft, cancelled]) {
      const response = await fetch(`${appBase()}/events/${id}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(names[id === draft ? "draft" : "cancelled"]);
    }
  });

  test("owner draft preview clearly identifies its private status", async () => {
    const response = await fetch(`${appBase()}/events/${draft}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(names.draft);
    expect(html).toContain("Draft");
    expect(html).toContain("/dashboard/events");
  });

  test("invalid and missing identifiers produce the designed 404", async () => {
    for (const id of ["not-an-event-id", "00000000-0000-4000-8000-000000000000"]) {
      const response = await fetch(`${appBase()}/events/${id}`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Something went wrong");
    }
  });
});
