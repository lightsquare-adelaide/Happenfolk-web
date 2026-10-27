import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  applyDiscoveryRedGuard,
  createPortfolioItem,
  injectViews,
  loadFixtures,
} from "./_harness";

/**
 * S1 — artist aggregate independence (migration 20261027000100).
 *
 * Regression against the personal-version defect: its trending_artists
 * joined page_views and published portfolio_items in ONE aggregate, so
 * every profile view row was multiplied by the artist's item count —
 * publishing a work silently doubled view_count and trending_score with
 * the page-view rows untouched. Here the two aggregates are independent
 * lateral subqueries.
 *
 * The pinned contract: with FIXED page-view fixtures, adding a published
 * work changes published_items ONLY; view_count stays exact and
 * trending_score stays within wall-clock drift (seconds of decay, far
 * below the x2 the defect would cause). Portfolio-item views never feed
 * the artist's view_count either — only profile-subject views do.
 *
 * DISCOVERY_RED=artist-join-multiply restores the defective single-join
 * shape and must turn this file red.
 */

let restore: (() => Promise<void>) | null = null;

beforeAll(async () => {
  restore = await applyDiscoveryRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
});

type ArtistRow = {
  id: string;
  published_items: number;
  view_count: number;
  trending_score: number;
};

async function readArtist(artistId: string): Promise<ArtistRow> {
  const { data, error } = await anonClient()
    .from("trending_artists")
    .select("id, published_items, view_count, trending_score")
    .eq("id", artistId)
    .maybeSingle();
  if (error) throw new Error(`trending_artists read failed: ${error.message}`);
  expect(data).not.toBeNull();
  return data as ArtistRow;
}

describe("S1 — artist aggregates are independent of item count", () => {
  it("publishing another work changes published_items only", async () => {
    const fx = await loadFixtures();

    const before = await readArtist(fx.musician.userId);
    expect(before.published_items).toBe(1);
    expect(before.view_count).toBe(2); // two fixed-age profile views
    expect(before.trending_score).toBeGreaterThan(0);

    const extra = await createPortfolioItem(
      fx.musician,
      `Aggregate Regression Work ${Date.now()}`,
      true,
    );
    try {
      const after = await readArtist(fx.musician.userId);
      expect(after.published_items).toBe(2);
      // The heart of the regression: same fixtures, same counts.
      expect(after.view_count).toBe(2);
      const drift = Math.abs(after.trending_score - before.trending_score);
      // Seconds of exponential decay are ~1e-5 relative; the defective
      // join would jump the score by a factor of ~2 (relative delta ~1).
      expect(drift).toBeLessThan(before.trending_score * 1e-3);
    } finally {
      await fx.musician.client.from("portfolio_items").delete().eq("id", extra.id);
    }
  });

  it("portfolio-item views never inflate the artist view_count", async () => {
    const fx = await loadFixtures();

    const before = await readArtist(fx.musician.userId);
    // Three views on the ITEM subject (not the profile subject).
    await injectViews("portfolio_item", fx.itemId, [5, 6, 7]);
    try {
      const after = await readArtist(fx.musician.userId);
      expect(after.view_count).toBe(before.view_count);
      const drift = Math.abs(after.trending_score - before.trending_score);
      expect(drift).toBeLessThan(before.trending_score * 1e-3);
    } finally {
      await (
        await admin()
      ).query(`delete from public.page_views where subject_id = $1`, [fx.itemId]);
    }
  });
});
