import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  applyDiscoveryRedGuard,
  createUser,
  loadFixtures,
  readViewIds,
  type TestUser,
} from "./_harness";

/**
 * S1 — recommendation rules (migration 20261027000100).
 *
 * Pinned contracts:
 * 1. Cold start: a brand-new member (zero affinity rows) sees EXACTLY
 *    the global trending sequence — the multiplier is 1 and the
 *    tiebreak chain is identical to the trending views'.
 * 2. Affinity identity is auth.uid(): likes rerank ONLY the liker's
 *    recommended_* — a second member and the trending views are
 *    untouched, and there is no parameter anywhere to select somebody
 *    else's affinity.
 * 3. Rerank is multiplicative, not lexicographic: three likes (affinity
 *    9 -> x19) lift every music fixture event above the film fixture
 *    events, which the fixtures deliberately make out-trend music ~3:1
 *    on raw momentum. Without genuine multiplication (red guard
 *    DISCOVERY_RED=affinity-off) this cannot pass.
 * 4. No personalization without a member: anonymous recommended_* (the
 *    invoker view with auth.uid() = null) is exactly the global order.
 */

let restore: (() => Promise<void>) | null = null;
const extraUsers: TestUser[] = [];

async function makeUser(label: string): Promise<TestUser> {
  const user = await createUser(`${label}-${Date.now().toString(36)}`);
  extraUsers.push(user);
  return user;
}

beforeAll(async () => {
  restore = await applyDiscoveryRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
  // Cleanup own accounts only (cascades remove their likes/views).
  const a = await admin();
  for (const u of extraUsers) {
    await a.query(`delete from auth.users where id = $1`, [u.userId]);
  }
});

describe("S1 — cold start equals global trending", () => {
  it("new member's recommended_events matches trending_events item for item", async () => {
    await loadFixtures();
    const newbie = await makeUser("cold-events");
    const trending = await readViewIds(anonClient(), "trending_events");
    const recommended = await readViewIds(newbie.client, "recommended_events");
    expect(trending.length).toBeGreaterThan(0);
    expect(recommended).toEqual(trending);
  });

  it("new member's recommended_artists matches trending_artists item for item", async () => {
    await loadFixtures();
    const newbie = await makeUser("cold-artists");
    const trending = await readViewIds(anonClient(), "trending_artists");
    const recommended = await readViewIds(newbie.client, "recommended_artists");
    expect(trending.length).toBeGreaterThan(0);
    expect(recommended).toEqual(trending);
  });

  it("anonymous recommended_events is the global order too (no personalization without a member)", async () => {
    await loadFixtures();
    const trending = await readViewIds(anonClient(), "trending_events");
    const recommended = await readViewIds(anonClient(), "recommended_events");
    expect(trending.length).toBeGreaterThan(0);
    expect(recommended).toEqual(trending);
  });
});

describe("S1 — affinity affects the current UID only", () => {
  it("likes lift the liked category for the liker and nobody else", async () => {
    const fx = await loadFixtures();
    const musicIds = [...fx.musicEvents.map((e) => e.id), fx.recentEvent.id, fx.oldEvent.id];
    const filmIds = fx.filmEvents.map((e) => e.id);
    const fixtureIds = [...musicIds, ...filmIds];

    // A cold member establishes the momentum baseline: film out-trends
    // music ~3:1, so every film fixture precedes every music fixture.
    const stranger = await makeUser("stranger");
    const strangerOrder = (await readViewIds(stranger.client, "recommended_events")).filter(
      (id) => fixtureIds.includes(id),
    );
    const strangerFirstMusic = strangerOrder.findIndex((id) => musicIds.includes(id));
    const strangerLastFilm = strangerOrder.map((id) => filmIds.includes(id)).lastIndexOf(true);
    expect(strangerLastFilm).toBeLessThan(strangerFirstMusic);

    // The liker likes THREE music events -> Music affinity 9 -> x19.
    const liker = await makeUser("liker");
    for (const id of fx.musicEvents.slice(0, 3).map((e) => e.id)) {
      const { error } = await liker.client.rpc("toggle_like", {
        p_subject_type: "event",
        p_subject_id: id,
      });
      expect(error).toBeNull();
    }

    const likerOrder = (await readViewIds(liker.client, "recommended_events")).filter((id) =>
      fixtureIds.includes(id),
    );
    expect(likerOrder.length).toBe(fixtureIds.length);
    const likerFirstFilm = likerOrder.findIndex((id) => filmIds.includes(id));
    const likerLastMusic = likerOrder.map((id) => musicIds.includes(id)).lastIndexOf(true);
    // Multiplicative rerank: EVERY music fixture (even the 6-day-old
    // 0.37-score one at x19 ~= 7.0) now precedes EVERY film fixture (~2.9).
    expect(likerLastMusic).toBeLessThan(likerFirstFilm);

    // The stranger is unaffected by somebody else's likes, and still
    // equals the cold-start/trending baseline.
    const strangerAgain = (await readViewIds(stranger.client, "recommended_events")).filter(
      (id) => fixtureIds.includes(id),
    );
    expect(strangerAgain).toEqual(strangerOrder);

    // And the liker's own trending view (public, non-personalized) is
    // unchanged by the likes as well.
    const trending = (await readViewIds(anonClient(), "trending_events")).filter((id) =>
      fixtureIds.includes(id),
    );
    expect(trending).toEqual(strangerOrder);
  });
});
