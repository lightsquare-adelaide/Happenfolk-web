import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyDiscoveryRedGuard,
  loadFixtures,
  MUSIC,
  FILM,
  runId,
} from "./_harness";

/**
 * S1 — discovery search RPCs (migration 20261027000100).
 *
 * Contracts pinned here:
 * - FTS (search_vector triggers from 0006) finds exact titles; pg_trgm
 *   survives one or two dropped letters.
 * - Empty query = category browsing; unknown text = clean empty result;
 *   malformed operators never raise (websearch_to_tsquery is total).
 * - Strict bounds: limit clamps to 1..100 (default 24); queries over
 *   200 BYTES raise QUERY_TOO_LONG (byte length, not character count).
 * - Privacy: search_items requires the item's published flag AND the
 *   owning profile's published flag. A private artist's published item
 *   is invisible to anonymous callers AND to the owner browsing
 *   discovery; an owner's draft item is invisible to the owner too
 *   (preview belongs to the dashboard, not discovery).
 *   DISCOVERY_RED=search-owner-blind drops the owner-profile predicate
 *   and must turn the privacy specs red.
 * - search_artists matches display_name and handle, honors the category
 *   filter, and excludes unpublished profiles.
 */

let restore: (() => Promise<void>) | null = null;

beforeAll(async () => {
  restore = await applyDiscoveryRedGuard();
});

afterAll(async () => {
  if (restore) await restore();
});

type ItemRow = { id: string; title: string; profile_id: string; category_id: number };
type EventRow = { id: string; title: string; category_id: number };
type ArtistRow = { id: string; handle: string; display_name: string; category_id: number };

describe("S1 — item search", () => {
  it("finds a published item by exact title (FTS)", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_items", {
      p_query: fx.itemTitle,
      p_category_id: null,
      p_limit: 10,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as ItemRow[];
    expect(rows.some((r) => r.id === fx.itemId)).toBe(true);
  });

  it("still finds it with two dropped letters (trigram)", async () => {
    const fx = await loadFixtures();
    const typo = fx.itemTitle.replace("Qwerty", "Qwety").replace("Fixture", "Fixtur");
    expect(typo).not.toBe(fx.itemTitle);
    const { data, error } = await anonClient().rpc("search_items", {
      p_query: typo,
      p_category_id: null,
      p_limit: 10,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as ItemRow[];
    expect(rows.some((r) => r.id === fx.itemId)).toBe(true);
  });

  it("returns a clean empty result for text that matches nothing", async () => {
    await loadFixtures();
    for (const rpc of ["search_items", "search_events", "search_artists"] as const) {
      const { data, error } = await anonClient().rpc(rpc, {
        p_query: `zzqqxx9173absent${runId}`,
        p_category_id: null,
        p_limit: 10,
      });
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    }
  });

  it("never raises on malformed query operators", async () => {
    await loadFixtures();
    for (const q of ["!!! &&& ||| ---", "'\"()<>", "a!b@c#d$e%f^g&h*"]) {
      const { error } = await anonClient().rpc("search_items", {
        p_query: q,
        p_category_id: null,
        p_limit: 10,
      });
      expect(error).toBeNull();
    }
  });

  it("hides a private artist's published item from everyone, owner included", async () => {
    const fx = await loadFixtures();
    // Anonymous: invisible.
    const asAnon = await anonClient().rpc("search_items", {
      p_query: fx.privateItemTitle,
      p_category_id: null,
      p_limit: 10,
    });
    expect(asAnon.error).toBeNull();
    expect(((asAnon.data ?? []) as ItemRow[]).some((r) => r.id === fx.privateItemId)).toBe(false);

    // The owner themself, browsing discovery: still invisible. RLS alone
    // would show it (published item, own profile row); the RPC's
    // owner-profile published predicate is what closes the shortcut.
    const asOwner = await fx.privateArtist.client.rpc("search_items", {
      p_query: fx.privateItemTitle,
      p_category_id: null,
      p_limit: 10,
    });
    expect(asOwner.error).toBeNull();
    expect(((asOwner.data ?? []) as ItemRow[]).some((r) => r.id === fx.privateItemId)).toBe(false);
  });

  it("hides an owner's own draft item from discovery (owner included)", async () => {
    const fx = await loadFixtures();
    const asOwner = await fx.musician.client.rpc("search_items", {
      p_query: fx.draftItemTitle,
      p_category_id: null,
      p_limit: 10,
    });
    expect(asOwner.error).toBeNull();
    const rows = (asOwner.data ?? []) as ItemRow[];
    expect(rows.some((r) => r.title === fx.draftItemTitle)).toBe(false);
  });

  it("empty query browses and the category filter restricts", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_items", {
      p_query: "",
      p_category_id: MUSIC,
      p_limit: 100,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as ItemRow[];
    expect(rows.every((r) => r.category_id === MUSIC)).toBe(true);
    expect(rows.some((r) => r.id === fx.itemId)).toBe(true);
    expect(rows.some((r) => r.id === fx.privateItemId)).toBe(false);
  });
});

describe("S1 — event search", () => {
  it("finds a fixture event title via FTS", async () => {
    const fx = await loadFixtures();
    const target = fx.musicEvents[3];
    const { data, error } = await anonClient().rpc("search_events", {
      p_query: target.title,
      p_category_id: null,
      p_limit: 5,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as EventRow[];
    expect(rows.slice(0, 3).some((r) => r.id === target.id)).toBe(true);
  });

  it("category filter returns only that category", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: FILM,
      p_limit: 100,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as EventRow[];
    expect(rows.length).toBeGreaterThanOrEqual(fx.filmEvents.length);
    expect(rows.every((r) => r.category_id === FILM)).toBe(true);
    expect(rows.some((r) => r.title.includes(`Music Discovery Event ${runId}`))).toBe(false);
  });

  it("excludes draft and cancelled events", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_events", {
      p_query: `Discovery Gig ${runId}`,
      p_category_id: null,
      p_limit: 100,
    });
    expect(error).toBeNull();
    const ids = ((data ?? []) as EventRow[]).map((r) => r.id);
    expect(ids).not.toContain(fx.draftEvent.id);
    expect(ids).not.toContain(fx.cancelledEvent.id);
  });

  it("an unknown category id simply matches nothing", async () => {
    await loadFixtures();
    const { data, error } = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: 12000,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

describe("S1 — artist search", () => {
  it("matches display_name and handle, excludes unpublished profiles", async () => {
    const fx = await loadFixtures();
    const byName = await anonClient().rpc("search_artists", {
      p_query: `Discoverable Musician ${runId}`,
      p_category_id: null,
      p_limit: 10,
    });
    expect(byName.error).toBeNull();
    expect(((byName.data ?? []) as ArtistRow[]).some((r) => r.id === fx.musician.userId)).toBe(true);

    // Read the real handle (the profile trigger derives it from the
    // email local part, sanitized and truncated), then search by it.
    const profile = await fx.musician.client
      .from("profiles")
      .select("handle")
      .eq("id", fx.musician.userId)
      .single();
    expect(profile.error).toBeNull();
    const handle = (profile.data as { handle: string }).handle;
    const byHandle = await anonClient().rpc("search_artists", {
      p_query: handle,
      p_category_id: null,
      p_limit: 10,
    });
    expect(byHandle.error).toBeNull();
    expect(((byHandle.data ?? []) as ArtistRow[]).some((r) => r.id === fx.musician.userId)).toBe(true);

    const privateSearch = await anonClient().rpc("search_artists", {
      p_query: `Hidden Artist ${runId}`,
      p_category_id: null,
      p_limit: 10,
    });
    expect(privateSearch.error).toBeNull();
    expect(((privateSearch.data ?? []) as ArtistRow[]).some((r) => r.id === fx.privateArtist.userId)).toBe(
      false,
    );
  });

  it("category filter restricts to that category", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_artists", {
      p_query: "",
      p_category_id: FILM,
      p_limit: 100,
    });
    expect(error).toBeNull();
    const rows = (data ?? []) as ArtistRow[];
    expect(rows.every((r) => r.category_id === FILM)).toBe(true);
    expect(rows.some((r) => r.id === fx.filmmaker.userId)).toBe(true);
    expect(rows.some((r) => r.id === fx.musician.userId)).toBe(false);
  });
});

describe("S1 — strict input bounds", () => {
  it("clamps extreme limits into 1..100", async () => {
    await loadFixtures();
    const zero = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: null,
      p_limit: 0,
    });
    expect(zero.error).toBeNull();
    expect(((zero.data ?? []) as EventRow[]).length).toBe(1);

    const negative = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: null,
      p_limit: -50,
    });
    expect(negative.error).toBeNull();
    expect(((negative.data ?? []) as EventRow[]).length).toBe(1);

    const huge = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: null,
      p_limit: 100000,
    });
    expect(huge.error).toBeNull();
    expect(((huge.data ?? []) as EventRow[]).length).toBeLessThanOrEqual(100);

    const defaulted = await anonClient().rpc("search_events", {
      p_query: "",
      p_category_id: null,
      p_limit: null,
    });
    expect(defaulted.error).toBeNull();
    expect(((defaulted.data ?? []) as EventRow[]).length).toBeLessThanOrEqual(24);
  });

  it("rejects queries over 200 bytes with QUERY_TOO_LONG", async () => {
    await loadFixtures();
    const long = await anonClient().rpc("search_items", {
      p_query: "x".repeat(201),
      p_category_id: null,
      p_limit: 10,
    });
    expect(long.error).not.toBeNull();
    expect(long.error!.message).toContain("QUERY_TOO_LONG");

    // Byte length, not character count: 100 two-byte characters pass,
    // 101 (202 bytes) do not.
    const ok = await anonClient().rpc("search_items", {
      p_query: "é".repeat(100),
      p_category_id: null,
      p_limit: 10,
    });
    expect(ok.error).toBeNull();
    const tooLong = await anonClient().rpc("search_items", {
      p_query: "é".repeat(101),
      p_category_id: null,
      p_limit: 10,
    });
    expect(tooLong.error).not.toBeNull();
    expect(tooLong.error!.message).toContain("QUERY_TOO_LONG");
  });

  it("trims surrounding whitespace before matching", async () => {
    const fx = await loadFixtures();
    const { data, error } = await anonClient().rpc("search_items", {
      p_query: `   ${fx.itemTitle}   `,
      p_category_id: null,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(((data ?? []) as ItemRow[]).some((r) => r.id === fx.itemId)).toBe(true);
  });
});
