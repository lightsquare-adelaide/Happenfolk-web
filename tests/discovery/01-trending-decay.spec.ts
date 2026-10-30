import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  applyDiscoveryRedGuard,
  createEvent,
  injectViews,
  loadFixtures,
} from "./_harness";

/**
 * S1 — time-decayed trending ranking (migration 20261027000100).
 *
 * The score is the 7-day view sum with a 48-hour half-life. The fixture
 * pins the discriminating case: ONE view from an hour ago (score ~0.97,
 * count 1) must outrank THREE views from six days ago (score ~0.37,
 * count 3). Raw counting would order them the other way round, so
 * DISCOVERY_RED=score-decay-off must turn this file red.
 *
 * Also pinned here: cancelled/draft events never surface (they carry
 * heavy fresh fixture views, so any leak reorders loudly), unpublished
 * profiles are absent from trending_artists, zero-view rows tie-break
 * deterministically on starts_at, and repeated reads are stable.
 */

let restore: (() => Promise<void>) | null = null;

beforeAll(async () => {
  restore = await applyDiscoveryRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
});

type TrendingEventRow = {
  id: string;
  view_count: number;
  trending_score: number;
  starts_at: string;
};

describe("S1 — trending decay and exclusions", () => {
  it("one fresh view outranks three six-day-old views", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient()
      .from("trending_events")
      .select("id, view_count, trending_score, starts_at")
      .in("id", [fx.recentEvent.id, fx.oldEvent.id]);
    expect(error).toBeNull();
    const rows = (data ?? []) as TrendingEventRow[];
    expect(rows.map((r) => r.id)).toEqual([fx.recentEvent.id, fx.oldEvent.id]);

    const recent = rows[0];
    const old = rows[1];
    // The raw counts deliberately disagree with the ranking.
    expect(recent.view_count).toBe(1);
    expect(old.view_count).toBe(3);
    expect(recent.trending_score).toBeGreaterThan(old.trending_score);
    // exp(-ln2/2 * 1/24) ~= 0.9857 for the fresh single view.
    expect(recent.trending_score).toBeCloseTo(0.9857, 2);
    // 3 * exp(-ln2/2 * 6) ~= 0.375 for the aged trio.
    expect(old.trending_score).toBeCloseTo(0.375, 2);
  });

  it("cancelled and draft events never appear, despite heavy fresh views", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().from("trending_events").select("id");
    expect(error).toBeNull();
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    expect(ids).not.toContain(fx.cancelledEvent.id);
    expect(ids).not.toContain(fx.draftEvent.id);
    expect(ids).toContain(fx.recentEvent.id);
    expect(ids).toContain(fx.oldEvent.id);
  });

  it("trending_artists hides unpublished profiles and counts profile views", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient()
      .from("trending_artists")
      .select("id, view_count, trending_score, published_items");
    expect(error).toBeNull();
    const rows = (data ?? []) as {
      id: string;
      view_count: number;
      trending_score: number;
      published_items: number;
    }[];
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fx.musician.userId);
    expect(ids).toContain(fx.filmmaker.userId);
    expect(ids).not.toContain(fx.privateArtist.userId);

    const musician = rows.find((r) => r.id === fx.musician.userId)!;
    // Two fixed-age profile views (2h, 3h) from the harness fixture.
    expect(musician.view_count).toBe(2);
    expect(musician.trending_score).toBeGreaterThan(0);
    expect(musician.published_items).toBe(1);
  });

  it("zero-view rows tie-break deterministically on starts_at, then id", async () => {
    const fx = await loadFixtures();
    const early = await createEvent(fx.musician, `Tiebreak Early ${Date.now()}`, 1, "published", 72);
    const late = await createEvent(fx.musician, `Tiebreak Late ${Date.now()}`, 1, "published", 96);
    try {
      const { data, error } = await anonClient()
        .from("trending_events")
        .select("id, trending_score, starts_at")
        .in("id", [early.id, late.id]);
      expect(error).toBeNull();
      const rows = (data ?? []) as TrendingEventRow[];
      expect(rows.map((r) => r.id)).toEqual([early.id, late.id]);
      expect(rows.every((r) => r.trending_score === 0)).toBe(true);
    } finally {
      // Own fixtures only: the host may delete own events (RLS path).
      await fx.musician.client.from("events").delete().eq("id", early.id);
      await fx.musician.client.from("events").delete().eq("id", late.id);
    }
  });

  it("repeated anonymous reads return the identical sequence", async () => {
    await loadFixtures();
    const first = await anonClient().from("trending_events").select("id");
    const second = await anonClient().from("trending_events").select("id");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(((second.data ?? []) as { id: string }[]).map((r) => r.id)).toEqual(
      ((first.data ?? []) as { id: string }[]).map((r) => r.id),
    );
  });

  it("views older than the 7-day window do not contribute", async () => {
    const fx = await loadFixtures();
    const stale = await createEvent(fx.musician, `Stale Window ${Date.now()}`, 1, "published", 24);
    try {
      // One view just inside the window, one just outside (8 days).
      await injectViews("event", stale.id, [60, 8 * 24 * 60]);
      const { data, error } = await anonClient()
        .from("trending_events")
        .select("id, view_count, trending_score")
        .eq("id", stale.id)
        .maybeSingle();
      expect(error).toBeNull();
      const row = data as TrendingEventRow | null;
      expect(row).not.toBeNull();
      expect(row!.view_count).toBe(1); // the 8-day-old row is filtered out
      expect(row!.trending_score).toBeCloseTo(0.9857, 2);
    } finally {
      await (await admin()).query(
        `delete from public.page_views where subject_id = $1`,
        [stale.id],
      );
      await fx.musician.client.from("events").delete().eq("id", stale.id);
    }
  });
});
