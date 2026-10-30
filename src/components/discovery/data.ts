import { coverAsset, type MediaRow } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type Category = { id: number; name: string };

export type EventCard = {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  coverUrl: string | null;
  categoryId: number | null;
  priceCents: number | null;
  trending: boolean;
};

export type ArtistCardData = {
  id: string;
  handle: string;
  displayName: string;
  categoryId: number | null;
  avatarUrl: string | null;
  publishedItems: number | null;
  trending: boolean;
};

export type WorkCardData = {
  id: string;
  title: string;
  artistHandle: string;
  artistName: string;
  coverUrl: string | null;
  smallCoverUrl?: string | null;
  smallWidth?: number | null;
  alt: string;
  width: number | null;
  height: number | null;
};

export async function loadCategories(supabase: Supabase): Promise<Category[]> {
  const { data } = await supabase.from("categories").select("id, name").order("sort_order");
  return data ?? [];
}

export function categoryNameMap(categories: Category[]): Map<number, string> {
  return new Map(categories.map((category) => [category.id, category.name]));
}

export function avatarUrl(supabase: Supabase, path: string | null): string | null {
  return path ? supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl : null;
}

export function coverUrl(supabase: Supabase, path: string | null): string | null {
  return path ? supabase.storage.from("covers").getPublicUrl(path).data.publicUrl : null;
}

const EVENT_FIELDS = "id, title, starts_at, location, cover_path, category_id, price_cents";

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  cover_path: string | null;
  category_id: number | null;
  price_cents: number | null;
};

function toEventCard(supabase: Supabase, row: EventRow, trending: boolean): EventCard {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    location: row.location,
    coverUrl: coverUrl(supabase, row.cover_path),
    categoryId: row.category_id,
    priceCents: row.price_cents,
    trending,
  };
}

/** Event cards for known ids, kept in the order of `ids` (RLS-filtered). */
export async function loadEventsByIds(supabase: Supabase, ids: string[], trendingIds: Set<string> = new Set()) {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("public_events").select(EVENT_FIELDS).in("id", ids).eq("status", "published");
  const byId = new Map((data ?? []).map((row) => [row.id, row as EventRow]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toEventCard(supabase, row, trendingIds.has(id))] : [];
  });
}

/** Upcoming trending events first (scored rows only), topped up by newest listings. */
export async function loadHomeEvents(supabase: Supabase, signedIn: boolean, size: number) {
  const now = new Date().toISOString();
  const view = signedIn ? "recommended_events" : "trending_events";
  const [scored, recent] = await Promise.all([
    supabase.from(view).select("id, trending_score").gte("starts_at", now).gt("trending_score", 0).limit(size),
    supabase.from("public_events").select(EVENT_FIELDS).eq("status", "published").gte("starts_at", now)
      .order("created_at", { ascending: false }).order("id").limit(size),
  ]);
  const scoredRows = (scored.data ?? []).filter((row): row is { id: string; trending_score: number } =>
    row.id !== null && row.trending_score !== null);
  const trendingIds = scoredRows.map((row) => row.id);
  const trendingCards = await loadEventsByIds(supabase, trendingIds, new Set(trendingIds));
  const recentCards = ((recent.data ?? []) as EventRow[]).map((row) => toEventCard(supabase, row, false));
  const seen = new Set(trendingCards.map((card) => card.id));
  const cards = [...trendingCards, ...recentCards.filter((card) => !seen.has(card.id))].slice(0, size);
  return { cards, isTrending: trendingCards.length > 0, failed: scored.error != null || recent.error != null };
}

type ArtistViewRow = {
  id: string | null;
  handle: string | null;
  display_name: string | null;
  category_id: number | null;
  avatar_path: string | null;
  published_items: number | null;
  trending_score?: number | null;
};

function toArtistCard(supabase: Supabase, row: ArtistViewRow, trending: boolean): ArtistCardData | null {
  if (!row.id || !row.handle) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name?.trim() || row.handle,
    categoryId: row.category_id,
    avatarUrl: avatarUrl(supabase, row.avatar_path),
    publishedItems: row.published_items,
    trending,
  };
}

const ARTIST_FIELDS = "id, handle, display_name, category_id, avatar_path, published_items, trending_score";

/** Trending artists first (scored rows only), topped up by newest published profiles. */
export async function loadHomeArtists(supabase: Supabase, signedIn: boolean, size: number) {
  const view = signedIn ? "recommended_artists" : "trending_artists";
  const [scored, recent] = await Promise.all([
    supabase.from(view).select(ARTIST_FIELDS).gt("trending_score", 0).limit(size),
    supabase.from("profiles").select("id").eq("published", true)
      .order("created_at", { ascending: false }).order("id").limit(size),
  ]);
  const trendingCards = (scored.data ?? []).flatMap((row) => toArtistCard(supabase, row, true) ?? []);
  const seen = new Set(trendingCards.map((card) => card.id));
  const recentIds = (recent.data ?? []).map((row) => row.id).filter((id) => !seen.has(id));
  // The view carries the work counts; fetch them for the recent ids only.
  const { data: details } = recentIds.length
    ? await supabase.from("trending_artists").select(ARTIST_FIELDS).in("id", recentIds)
    : { data: [] as ArtistViewRow[] };
  const byId = new Map((details ?? []).map((row) => [row.id, row]));
  const recentCards = recentIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? toArtistCard(supabase, row, false) ?? [] : [];
  });
  const cards = [...trendingCards, ...recentCards].slice(0, size);
  return { cards, isTrending: trendingCards.length > 0, failed: scored.error != null || recent.error != null };
}

type WorkRow = {
  id: string;
  title: string;
  profiles: { handle: string; display_name: string | null } | { handle: string; display_name: string | null }[] | null;
};

async function attachCovers(supabase: Supabase, rows: WorkRow[]): Promise<WorkCardData[]> {
  if (rows.length === 0) return [];
  const { data: media } = await supabase
    .from("media_assets")
    .select("portfolio_item_id, path, alt_text, width, height, bucket, content_type, variant, position")
    .eq("bucket", "media")
    .in("portfolio_item_id", rows.map((row) => row.id));
  return rows.flatMap((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile) return [];
    const mine = (media ?? []).filter((m) => m.portfolio_item_id === row.id) as Array<MediaRow & { portfolio_item_id: string }>;
    const cover = coverAsset(mine);
    const stem = (path: string) => path.replace(/-(?:medium|small)\.[^/.]+$/, "");
    const small = cover ? mine.find((m) => m.bucket === cover.bucket && m.variant === "small" && stem(m.path) === stem(cover.path)) : null;
    const artistName = profile.display_name?.trim() || profile.handle;
    return [{
      id: row.id,
      title: row.title,
      artistHandle: profile.handle,
      artistName,
      coverUrl: cover ? supabase.storage.from("media").getPublicUrl(cover.path).data.publicUrl : null,
      smallCoverUrl: small ? supabase.storage.from("media").getPublicUrl(small.path).data.publicUrl : null,
      smallWidth: small?.width ?? null,
      alt: cover?.alt_text?.trim() || `${row.title}, by ${artistName}`,
      width: cover?.width ?? null,
      height: cover?.height ?? null,
    }];
  });
}

const WORK_SELECT = "id, title, profiles!inner(handle, display_name)";

/** Newest published works whose owning profile is also published (inner join + RLS). */
export async function loadRecentWorks(supabase: Supabase, size: number) {
  const { data, error } = await supabase.from("portfolio_items").select(WORK_SELECT)
    .eq("published", true).order("created_at", { ascending: false }).order("id").limit(size);
  return { works: await attachCovers(supabase, (data ?? []) as WorkRow[]), failed: error != null };
}

/** Work cards for known ids, kept in the order of `ids`. */
export async function loadWorksByIds(supabase: Supabase, ids: string[]) {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("portfolio_items").select(WORK_SELECT)
    .eq("published", true).in("id", ids);
  const byId = new Map(((data ?? []) as WorkRow[]).map((row) => [row.id, row]));
  const rows = ids.flatMap((id) => byId.get(id) ?? []);
  return attachCovers(supabase, rows);
}
