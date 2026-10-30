import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createUser,
  type TestUser,
  withPg,
} from "./_harness";

/**
 * End-to-end database verification for Task B features:
 * - profile contact_email check constraint & open_to_collaborate directory filter
 * - toggle_like & like_counts on published vs hidden/draft works
 * - admin_staff, is_staff(), guard_is_hidden trigger, admin_set_hidden,
 *   admin_update_*, and exclusion of hidden rows from public RLS,
 *   trending/recommended views, and search_* RPCs.
 */
describe("compliance · collaborate directory, likes & admin hiding", () => {
  let artist: TestUser;
  let staffUser: TestUser;
  let viewer: TestUser;
  let itemId: string;
  let eventId: string;
  const uniqueToken = `hfb${Date.now()}`;

  beforeAll(async () => {
    artist = await createUser("b-artist");
    staffUser = await createUser("b-staff");
    viewer = await createUser("b-viewer");

    await withPg(async (db) => {
      await db.query(
        "insert into public.admin_staff (member_id) values ($1) on conflict do nothing",
        [staffUser.userId],
      );
    });

    const admin = adminClient();
    const { error: profErr } = await admin
      .from("profiles")
      .update({
        display_name: `Artist ${uniqueToken}`,
        account_kind: "individual",
        category_id: 1,
        bio: `Practitioner bio ${uniqueToken}`,
        contact_email: "studio@happenfolk.org",
        open_to_collaborate: true,
        published: true,
      })
      .eq("id", artist.userId);
    expect(profErr).toBeNull();

    // Create a portfolio item with public media so it can be published.
    const { data: item, error: itemErr } = await admin
      .from("portfolio_items")
      .insert({
        profile_id: artist.userId,
        title: `Work ${uniqueToken}`,
        description: `Work description ${uniqueToken}`,
        media_kind: "image",
        published: false,
      })
      .select("id")
      .single();
    expect(itemErr).toBeNull();
    itemId = item!.id;

    const { error: mediaErr } = await admin.from("media_assets").insert({
      portfolio_item_id: itemId,
      bucket: "media",
      path: `${artist.userId}/${itemId}/display.webp`,
      content_type: "image/webp",
      variant: "medium",
      alt_text: "Test artwork",
      width: 100,
      height: 100,
      position: 0,
    });
    expect(mediaErr).toBeNull();

    const { error: pubErr } = await admin
      .from("portfolio_items")
      .update({ published: true })
      .eq("id", itemId);
    expect(pubErr).toBeNull();

    const { data: ev, error: evErr } = await admin
      .from("events")
      .insert({
        host_id: artist.userId,
        category_id: 1,
        title: `Event ${uniqueToken}`,
        description: `Event description ${uniqueToken}`,
        location: "Adelaide",
        starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        ends_at: new Date(Date.now() + 5 * 86_400_000 + 7_200_000).toISOString(),
        capacity: 25,
        price_cents: 0,
        status: "published",
      })
      .select("id")
      .single();
    expect(evErr).toBeNull();
    eventId = ev!.id;
  });

  afterAll(async () => {
    await withPg(async (db) => {
      if (eventId) {
        await db.query("delete from public.events where id = $1", [eventId]);
      }
      if (itemId) {
        await db.query("delete from public.portfolio_items where id = $1", [
          itemId,
        ]);
      }
      for (const u of [viewer, staffUser, artist]) {
        if (u) {
          await db.query("delete from auth.users where id = $1", [u.userId]);
        }
      }
    });
  });

  it("enforces profiles_contact_email_shape check constraint and surfaces open_to_collaborate", async () => {
    const { error: badEmail } = await artist.client
      .from("profiles")
      .update({ contact_email: "not-an-email" })
      .eq("id", artist.userId);
    expect(badEmail).not.toBeNull();

    const anon = anonClient();
    const { data: collabRows, error: collabErr } = await anon
      .from("profiles")
      .select("id, contact_email, open_to_collaborate")
      .eq("id", artist.userId)
      .eq("published", true)
      .eq("is_hidden", false)
      .eq("open_to_collaborate", true);
    expect(collabErr).toBeNull();
    expect(collabRows).toHaveLength(1);
    expect(collabRows![0].contact_email).toBe("studio@happenfolk.org");
  });

  it("toggles likes idempotently and updates public like_counts", async () => {
    const { data: first, error: err1 } = await viewer.client.rpc(
      "toggle_like",
      {
        p_subject_type: "portfolio_item",
        p_subject_id: itemId,
      },
    );
    expect(err1).toBeNull();
    expect(first).toBe(true);

    const anon = anonClient();
    const { data: countAfterLike } = await anon
      .from("like_counts")
      .select("like_count")
      .eq("subject_type", "portfolio_item")
      .eq("subject_id", itemId)
      .maybeSingle();
    expect(Number(countAfterLike?.like_count ?? 0)).toBe(1);

    const { data: second, error: err2 } = await viewer.client.rpc(
      "toggle_like",
      {
        p_subject_type: "portfolio_item",
        p_subject_id: itemId,
      },
    );
    expect(err2).toBeNull();
    expect(second).toBe(false);
  });

  it("blocks non-staff from mutating is_hidden or calling admin RPCs, and hides rows from public/discovery/search when staff hides them", async () => {
    // Non-staff direct update of is_hidden is blocked by guard_is_hidden trigger.
    const { error: directHide } = await artist.client
      .from("profiles")
      .update({ is_hidden: true })
      .eq("id", artist.userId);
    expect(directHide).not.toBeNull();

    // Non-staff RPC call is rejected with ADMIN_REQUIRED.
    const { error: nonStaffRpc } = await viewer.client.rpc("admin_set_hidden", {
      p_subject_type: "portfolio_item",
      p_subject_id: itemId,
      p_hidden: true,
    });
    expect(nonStaffRpc).not.toBeNull();
    expect(nonStaffRpc!.message).toContain("ADMIN_REQUIRED");

    expect((await viewer.client.rpc("toggle_like", {
      p_subject_type: "portfolio_item", p_subject_id: itemId,
    })).data).toBe(true);

    // Staff hides the item, event and profile.
    for (const [subjectType, subjectId] of [
      ["portfolio_item", itemId],
      ["event", eventId],
      ["profile", artist.userId],
    ] as const) {
      const { error } = await staffUser.client.rpc("admin_set_hidden", {
        p_subject_type: subjectType,
        p_subject_id: subjectId,
        p_hidden: true,
      });
      expect(error).toBeNull();
    }

    const { error: hiddenLikeError } = await viewer.client.rpc("toggle_like", {
      p_subject_type: "portfolio_item", p_subject_id: itemId,
    });
    expect(hiddenLikeError?.message).toContain("NOT_PUBLISHED");

    const anon = anonClient();
    for (const [view, id] of [
      ["recommended_artists", artist.userId], ["recommended_events", eventId],
    ]) {
      const result = await anon.from(view).select("id").eq("id", id);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    // Hidden rows disappear from public SELECT, discovery views, and search RPCs.
    const { data: pubProf } = await anon
      .from("profiles")
      .select("id")
      .eq("id", artist.userId);
    expect(pubProf).toEqual([]);

    const { data: pubItem } = await anon
      .from("portfolio_items")
      .select("id")
      .eq("id", itemId);
    expect(pubItem).toEqual([]);

    const { data: pubEv } = await anon
      .from("events")
      .select("id")
      .eq("id", eventId);
    expect(pubEv).toEqual([]);

    const { data: trendEv } = await anon
      .from("trending_events")
      .select("id")
      .eq("id", eventId);
    expect(trendEv).toEqual([]);

    const { data: trendArt } = await anon
      .from("trending_artists")
      .select("id")
      .eq("id", artist.userId);
    expect(trendArt).toEqual([]);

    const { data: sEv } = await anon.rpc("search_events", {
      p_query: uniqueToken,
    });
    expect(sEv ?? []).toEqual([]);

    const { data: sArt } = await anon.rpc("search_artists", {
      p_query: uniqueToken,
    });
    expect(sArt ?? []).toEqual([]);

    const { data: sIt } = await anon.rpc("search_items", {
      p_query: uniqueToken,
    });
    expect(sIt ?? []).toEqual([]);

    const hiddenCounts = await anon.from("like_counts").select("subject_id")
      .eq("subject_type", "portfolio_item").eq("subject_id", itemId);
    expect(hiddenCounts.error).toBeNull();
    expect(hiddenCounts.data).toEqual([]);

    // Owner still sees their own rows via the owner arm of RLS.
    const { data: ownerProf } = await artist.client
      .from("profiles")
      .select("id, is_hidden")
      .eq("id", artist.userId)
      .maybeSingle();
    expect(ownerProf?.is_hidden).toBe(true);

    // Staff unhides all three and updates profile bio via admin_update_profile.
    for (const [subjectType, subjectId] of [
      ["portfolio_item", itemId],
      ["event", eventId],
      ["profile", artist.userId],
    ] as const) {
      const { error } = await staffUser.client.rpc("admin_set_hidden", {
        p_subject_type: subjectType,
        p_subject_id: subjectId,
        p_hidden: false,
      });
      expect(error).toBeNull();
    }

    const { error: updErr } = await staffUser.client.rpc(
      "admin_update_profile",
      {
        p_member_id: artist.userId,
        p_display_name: `Artist ${uniqueToken}`,
        p_bio: `Updated bio ${uniqueToken}`,
      },
    );
    expect(updErr).toBeNull();
  });
});
