import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, createEvent, createUser, type TestUser } from "./_harness";

const venue = `Private venue ${crypto.randomUUID()}, 18 Secret Street`;
const details = `Member-only event details ${crypto.randomUUID()}`;
let host: TestUser;
let member: TestUser;
let eventId: string;

beforeAll(async () => {
  host = await createUser("venue-host");
  member = await createUser("venue-member");
  eventId = (await createEvent(host, "Venue privacy exhibition", "published")).id;
  const updated = await host.client.from("events").update({ location: venue, description: details }).eq("id", eventId);
  expect(updated.error).toBeNull();
});
afterAll(async () => {
  const db = await admin();
  await db.query("delete from auth.users where id = any($1::uuid[])", [[host?.userId, member?.userId].filter(Boolean)]);
  await db.end();
});

describe("exact event venues and full details require membership", () => {
  it("denies anonymous REST reads, wildcard reads and predicates on private columns", async () => {
    for (const column of ["location", "description", "*"]) {
      const result = await anonClient().from("events").select(column).eq("id", eventId);
      expect(result.error, column).not.toBeNull();
      expect(JSON.stringify(result.data)).not.toContain(venue);
    }
    for (const query of [
      anonClient().from("events").select("id").eq("location", venue),
      anonClient().from("events").select("id").order("location"),
    ]) expect((await query).error).not.toBeNull();
    const summary = await anonClient().from("events").select("id, title").eq("id", eventId).single();
    expect(summary.error).toBeNull();
    expect(summary.data?.id).toBe(eventId);
  });

  it("returns a usable public summary with null private fields", async () => {
    const result = await anonClient().from("public_events").select("*").eq("id", eventId).single();
    expect(result.error).toBeNull();
    expect(result.data?.title).toBe("Venue privacy exhibition");
    expect(result.data?.location).toBeNull();
    expect(result.data?.description).toBeNull();
  });

  it("does not leak through any anonymous-readable public view", async () => {
    const db = await admin();
    const { rows } = await db.query<{ viewname: string }>(`select viewname from pg_views
      where schemaname = 'public' and has_table_privilege('anon', quote_ident(schemaname)||'.'||quote_ident(viewname), 'SELECT')`);
    expect(rows.length).toBeGreaterThan(0);
    for (const { viewname } of rows) {
      const result = await anonClient().from(viewname).select("*");
      if (result.error) expect(result.error.code, viewname).toBe("42501");
      const payload = JSON.stringify(result.data);
      expect(payload, viewname).not.toContain(venue);
      expect(payload, viewname).not.toContain(details);
    }
  });

  it("does not leak through any public search RPC in browse or search mode", async () => {
    for (const rpc of ["search_events", "search_artists", "search_items"]) {
      for (const p_query of [null, "Venue privacy exhibition"]) {
        const result = await anonClient().rpc(rpc, { p_query, p_limit: 100 });
        expect(result.error, rpc).toBeNull();
        expect(JSON.stringify(result.data), rpc).not.toContain(venue);
        expect(JSON.stringify(result.data), rpc).not.toContain(details);
        if (rpc === "search_events" && p_query) {
          const row = result.data.find((r: { id: string }) => r.id === eventId);
          expect(row).toBeDefined();
          expect(row.location).toBeNull();
        }
      }
    }
  });

  it("allows an unrelated signed-in member to read the venue through table, view and RPC", async () => {
    for (const table of ["events", "public_events"]) {
      const result = await member.client.from(table).select("location, description").eq("id", eventId).single();
      expect(result.error, table).toBeNull();
      expect(result.data).toEqual({ location: venue, description: details });
    }
    const result = await member.client.rpc("search_events", { p_query: "Venue privacy exhibition" });
    expect(result.error).toBeNull();
    expect(result.data.find((r: { id: string }) => r.id === eventId)?.location).toBe(venue);
  });

  it("does not expose draft, cancelled or hidden events through the public summary", async () => {
    const db = await admin();
    for (const values of [{ status: "draft" }, { status: "cancelled" }, { status: "published", is_hidden: true }]) {
      await db.query("update public.events set status=$1, is_hidden=$2 where id=$3", [values.status, values.is_hidden ?? false, eventId]);
      const result = await anonClient().from("public_events").select("*").eq("id", eventId);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    await db.query("update public.events set status='published', is_hidden=false where id=$1", [eventId]);
  });
});
