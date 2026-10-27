import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared server-side loader for the portfolio manager UI (used by both
 * /dashboard/portfolio and the compatible /dashboard/media entry).
 *
 * Owner-scoped reads through the caller's RLS client; ordering is the
 * accepted deterministic total order (position, created_at, id) for
 * items and for each item's draft originals. Private drafts are
 * previewed with short-lived SIGNED urls — never public drafts URLs.
 *
 * `stamp` is the remount key material for the client manager: it
 * changes when the item row OR its media SET/ORDER changes
 * (id/position), because uploads and media reorders do not necessarily
 * bump portfolio_items.updated_at. Caption (alt) changes are
 * deliberately NOT part of the stamp: they must remount only the single
 * edited asset row (see the AssetRow key in portfolio-manager.tsx),
 * never the whole card — a card-wide remount on caption save would
 * discard a sibling asset's in-progress input. Signed URL token churn
 * alone does NOT change the stamp, so a token refresh never resets an
 * in-progress edit.
 */

export type ManagedAsset = {
  id: string;
  altText: string;
  contentType: string;
  width: number | null;
  height: number | null;
  position: number;
  previewUrl: string | null;
};

export type ManagedWork = {
  id: string;
  title: string;
  description: string;
  year: number | null;
  tags: string[];
  published: boolean;
  stamp: string;
  assets: ManagedAsset[];
};

export type ManagedPortfolio = {
  works: ManagedWork[];
  handle: string | null;
  profilePublished: boolean;
  failed: boolean;
};

const SIGNED_URL_SECONDS = 3600;

export async function loadManagedPortfolio(
  supabase: SupabaseClient,
  uid: string,
): Promise<ManagedPortfolio> {
  const [profileRes, itemsRes] = await Promise.all([
    supabase.from("profiles").select("handle, published").eq("id", uid).maybeSingle(),
    supabase
      .from("portfolio_items")
      .select("id, title, description, year, tags, published, updated_at")
      .eq("profile_id", uid)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (itemsRes.error) {
    return { works: [], handle: null, profilePublished: false, failed: true };
  }

  const itemIds = (itemsRes.data ?? []).map((row) => row.id);
  const assetsRes = itemIds.length
    ? await supabase
        .from("media_assets")
        .select("id, portfolio_item_id, path, alt_text, content_type, width, height, position")
        .in("portfolio_item_id", itemIds)
        .eq("bucket", "drafts")
        .eq("variant", "original")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    : { data: [], error: null };
  if (assetsRes.error) {
    return { works: [], handle: null, profilePublished: false, failed: true };
  }

  const works: ManagedWork[] = [];
  for (const row of itemsRes.data ?? []) {
    const assets: ManagedAsset[] = [];
    for (const asset of (assetsRes.data ?? []).filter((a) => a.portfolio_item_id === row.id)) {
      const { data: signed } = await supabase.storage
        .from("drafts")
        .createSignedUrl(asset.path, SIGNED_URL_SECONDS);
      assets.push({
        id: asset.id,
        altText: asset.alt_text ?? "",
        contentType: asset.content_type,
        width: asset.width,
        height: asset.height,
        position: asset.position,
        previewUrl: signed?.signedUrl ?? null,
      });
    }
    const stamp = [
      row.updated_at,
      assets.map((asset) => `${asset.id}:${asset.position}`).join(","),
    ].join("|");
    works.push({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      year: row.year,
      tags: (row.tags ?? []) as string[],
      published: row.published,
      stamp,
      assets,
    });
  }

  return {
    works,
    handle: profileRes.data?.handle ?? null,
    profilePublished: profileRes.data?.published ?? false,
    failed: false,
  };
}
