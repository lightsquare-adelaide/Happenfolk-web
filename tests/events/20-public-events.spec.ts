import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { appBase, createUser, sessionCookieHeader, startApp, type TestUser } from "../auth/_harness";
import { stackConfig } from "../access/_harness";

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
    for (const status of ["published", "draft", "cancelled"] as const) {
      const inserted = await host.client.from("events").insert({ host_id: host.userId, title: names[status], location: "Adelaide exhibition space", description: "A public-facing artist exhibition.", starts_at: "2027-01-15T08:30:00Z", status }).select("id").single();
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

  test("anonymous directory exposes published events and their place and time", async () => {
    const response = await fetch(`${appBase()}/events`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(names.published);
    expect(html).toContain("Adelaide exhibition space");
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
    expect(html).toContain("Adelaide exhibition space");
    expect(html).toContain("A public-facing artist exhibition.");
    expect(html).toContain(`/artists/${handle}`);
    expect(html).toContain("Public event organising artist");
    expect(html).toContain("7:00 pm");
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
