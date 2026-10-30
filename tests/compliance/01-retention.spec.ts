import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createUser,
  type TestUser,
  withPg,
} from "./_harness";

/**
 * Data-minimisation & retention verification (migration 20261028200300):
 *
 * 1. Rows in `public.page_views` older than the retention window are
 *    rolled up into `public.page_views_monthly` (month, subject_type,
 *    subject_id, view_count — no viewer_id) and deleted from
 *    `public.page_views`.
 * 2. Rows inside the 90-day window are untouched.
 * 3. `run_page_view_retention` and `purge_page_views_before` are not
 *    callable by `anon` or `authenticated` roles.
 */
describe("compliance · page_views 90-day retention & monthly rollup (20261028200300)", () => {
  let host: TestUser;
  let viewer: TestUser;
  let eventId: string;

  beforeAll(async () => {
    host = await createUser("ret-host");
    viewer = await createUser("ret-viewer");
    const admin = adminClient();
    await admin
      .from("profiles")
      .update({ account_kind: "organisation", category_id: 1, published: true })
      .eq("id", host.userId);
    const { data: ev, error } = await admin
      .from("events")
      .insert({
        host_id: host.userId,
        category_id: 1,
        title: "Retention Fixture Event",
        description: "Event for 90-day retention verification.",
        location: "Adelaide",
        starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        ends_at: new Date(Date.now() + 7 * 86_400_000 + 7_200_000).toISOString(),
        capacity: 40,
        price_cents: 0,
        status: "published",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    eventId = ev!.id;
  });

  afterAll(async () => {
    await withPg(async (db) => {
      if (eventId) {
        await db.query(
          "delete from public.page_views_monthly where subject_id = $1",
          [eventId],
        );
        await db.query("delete from public.page_views where subject_id = $1", [
          eventId,
        ]);
        await db.query("delete from public.interactions where subject_id = $1", [eventId]);
        await db.query("delete from public.events where id = $1", [eventId]);
      }
      if (viewer) {
        await db.query("delete from auth.users where id = $1", [viewer.userId]);
      }
      if (host) {
        await db.query("delete from auth.users where id = $1", [host.userId]);
      }
    });
  });

  it("rolls up >90d rows into page_views_monthly without viewer_id and deletes raw rows", async () => {
    await withPg(async (db) => {
      await db.query(
        `insert into public.page_views (subject_type, subject_id, viewer_id, viewed_at)
         values
           ('event', $1, $2, now() - interval '120 days'),
           ('event', $1, null, now() - interval '119 days'),
           ('event', $1, $2, now() - interval '10 days')`,
        [eventId, viewer.userId],
      );

      const {
        rows: [res],
      } = await db.query<{ archived_rows: string; purged_rows: string }>(
        "select * from public.run_page_view_retention('90 days'::interval)",
      );
      expect(Number(res.archived_rows)).toBeGreaterThanOrEqual(1);
      expect(Number(res.purged_rows)).toBeGreaterThanOrEqual(2);

      const { rows: oldLeft } = await db.query(
        `select 1 from public.page_views
         where subject_id = $1 and viewed_at < now() - interval '90 days'`,
        [eventId],
      );
      expect(oldLeft.length).toBe(0);

      const { rows: recentLeft } = await db.query(
        `select 1 from public.page_views
         where subject_id = $1 and viewed_at >= now() - interval '90 days'`,
        [eventId],
      );
      expect(recentLeft.length).toBeGreaterThanOrEqual(1);

      const { rows: monthly } = await db.query<{ view_count: string }>(
        `select view_count from public.page_views_monthly
         where subject_type = 'event' and subject_id = $1`,
        [eventId],
      );
      const totalMonthly = monthly.reduce(
        (acc, r) => acc + Number(r.view_count),
        0,
      );
      expect(totalMonthly).toBeGreaterThanOrEqual(2);

      const { rows: cols } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'page_views_monthly'`,
      );
      expect(cols.map((c) => c.column_name)).not.toContain("viewer_id");
      expect(cols.map((c) => c.column_name)).not.toContain("visitor_hash");
    });
  });

  it("blocks anon and authenticated from calling run_page_view_retention", async () => {
    const anon = anonClient();
    const { error } = await anon.rpc("run_page_view_retention");
    expect(error).not.toBeNull();
    expect((await viewer.client.rpc("run_page_view_retention")).error).not.toBeNull();
    expect((await anon.rpc("purge_page_views_before", { p_cutoff: new Date().toISOString() })).error).not.toBeNull();
    expect((await viewer.client.rpc("purge_page_views_before", { p_cutoff: new Date().toISOString() })).error).not.toBeNull();
  });

  it("serializes concurrent jobs, preserves likes and schedules the daily run", async () => {
    const before = await withPg(async (db) => {
      const result = await db.query("select coalesce(sum(view_count),0)::int as n from public.page_views_monthly where subject_id=$1", [eventId]);
      await db.query("insert into public.page_views(subject_type,subject_id,viewed_at) select 'event',$1,now()-interval '130 days' from generate_series(1,3)", [eventId]);
      const cron = await db.query("select schedule, command from cron.job where jobname='page-view-retention' and active");
      expect(cron.rows).toEqual([{ schedule: "17 3 * * *", command: "select public.run_page_view_retention();" }]);
      return result.rows[0].n as number;
    });
    expect((await viewer.client.rpc("toggle_like", { p_subject_type: "event", p_subject_id: eventId })).error).toBeNull();
    await Promise.all([1, 2].map(() => withPg(async (db) => {
      await db.query("select * from public.run_page_view_retention()");
    })));
    await withPg(async (db) => {
      const result = await db.query("select sum(view_count)::int as n from public.page_views_monthly where subject_id=$1", [eventId]);
      expect(result.rows[0].n).toBe(before + 3);
      expect((await db.query("select count(*)::int as n from public.page_views where subject_id=$1", [eventId])).rows[0].n).toBe(1);
    });
    const likes = await viewer.client.from("interactions").select("subject_id").eq("subject_id", eventId);
    expect(likes.error).toBeNull();
    expect(likes.data).toHaveLength(1);
  });
});
