import { describe, expect, it } from "vitest";
import { withPg, anonClient, stackConfig } from "../compliance/_harness";

describe("launch seed integrity", () => {
  it("provides forty sample artists, 84 events and 120 works", async () => {
    await withPg(async (db) => {
      for (const [table, count] of [["profiles", 40], ["events", 84], ["portfolio_items", 120]] as const) {
        const result = await db.query(`select count(*)::int as n from public.${table} where id::text like 'fa00000%'`);
        expect(result.rows[0].n).toBe(count);
      }
      const { rows } = await db.query("select category_id, count(*)::int as n from public.events where id::text like 'fa00000%' group by category_id");
      expect(rows).toHaveLength(7);
      expect(rows.every((r) => r.n >= 10)).toBe(true);
    });
  });
  it("includes past/upcoming, free/paid, collaborative and private fixtures", async () => {
    await withPg(async (db) => {
      const { rows: [r] } = await db.query(`select
        count(*) filter(where starts_at < now())::int as past,
        count(*) filter(where starts_at > now())::int as upcoming,
        count(*) filter(where price_cents = 0)::int as free,
        count(*) filter(where price_cents > 0)::int as paid,
        count(*) filter(where is_hidden)::int as hidden,
        count(*) filter(where status = 'draft')::int as drafts
        from public.events where id::text like 'fa00000%'`);
      for (const n of Object.values(r)) expect(Number(n)).toBeGreaterThan(0);
      expect((await db.query("select count(*)::int as n from public.profiles where open_to_collaborate and id::text like 'fa00000%' ")).rows[0].n).toBeGreaterThan(0);
      expect((await db.query("select count(*)::int as n from (select event_id from public.event_collaborators where event_id::text like 'fa00000%' group by event_id having count(*) > 1) c")).rows[0].n).toBeGreaterThan(0);
      expect((await db.query("select count(*)::int as n from auth.users where email='demo.artist@happenfolk.test'")).rows[0].n).toBe(0);
    });
  });
  it("keeps hidden and draft samples out of anonymous discovery", async () => {
    const client = anonClient();
    for (const table of ["profiles", "events", "portfolio_items"]) {
      const { data, error } = await client.from(table).select("id,is_hidden");
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
      expect(data?.every((r) => !r.is_hidden)).toBe(true);
    }
  });
  it("lets the documented local sample account sign in", async () => {
    const client = anonClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: "sample.artist.01@example.test", password: "Sample-Happenfolk-2026!",
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBe("fa000001-0000-4000-8000-000000000001");
    expect(data.session).not.toBeNull();
    await client.auth.signOut();
  });
  it("serves real generated sample image bytes after seed:media", async () => {
    const { data, error } = await anonClient().from("media_assets").select("path")
      .eq("portfolio_item_id", "fa000003-0000-4000-8000-000000000001")
      .eq("bucket", "media").limit(1).single();
    expect(error).toBeNull();
    const res = await fetch(`${stackConfig().url}/storage/v1/object/public/media/${data!.path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/webp");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });

});
