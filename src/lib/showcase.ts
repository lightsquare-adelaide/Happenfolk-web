import { createSupabaseServerClient } from "@/lib/supabase/server";

// Preview-build read helpers for the Newsfeed, events and artist directory.
// RLS decides visibility; these only shape rows for display.

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type Category = { id: number; slug: string; name: string };
export type Person = { id: string; handle: string; display_name: string; category_id: number | null; avatarUrl: string | null };
export type EventCard = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  price_cents: number;
  capacity: number | null;
  category_id: number | null;
  coverUrl: string | null;
  host: Person | null;
  likes: number;
};

const url = (db: Client, bucket: string, path: string | null) =>
  path ? db.storage.from(bucket).getPublicUrl(path).data.publicUrl : null;

export function priceLabel(cents: number) {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

const dayMonth = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Adelaide" });
/** Day number and short month for the date block, in Adelaide time. */
export function dateParts(iso: string) {
  const parts = dayMonth.formatToParts(new Date(iso));
  return { day: parts.find((p) => p.type === "day")?.value ?? "", month: parts.find((p) => p.type === "month")?.value ?? "" };
}

export async function getCategories(db: Client): Promise<Category[]> {
  const { data } = await db.from("categories").select("id, slug, name").order("sort_order");
  return data ?? [];
}

export async function getPeople(db: Client, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const { data } = await db
    .from("profiles")
    .select("id, handle, display_name, category_id, avatar_path")
    .in("id", [...new Set(ids)]);
  return new Map((data ?? []).map((p) => [p.id, { ...p, avatarUrl: url(db, "avatars", p.avatar_path) }]));
}

async function likeCounts(db: Client, type: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const { data } = await db.from("like_counts").select("subject_id, like_count").eq("subject_type", type).in("subject_id", ids);
  return new Map((data ?? []).map((r) => [r.subject_id as string, Number(r.like_count)]));
}

/** Upcoming published events, soonest first. */
export async function getEvents(db: Client, opts: { limit?: number; hostId?: string; ids?: string[] } = {}): Promise<EventCard[]> {
  let q = db
    .from("events")
    .select("id, title, description, starts_at, price_cents, capacity, category_id, cover_path, host_id")
    .eq("status", "published")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");
  if (opts.hostId) q = q.eq("host_id", opts.hostId);
  if (opts.ids) q = q.in("id", opts.ids);
  if (opts.limit) q = q.limit(opts.limit);
  const { data } = await q;
  const rows = data ?? [];
  const [people, likes] = await Promise.all([
    getPeople(db, rows.map((e) => e.host_id)),
    likeCounts(db, "event", rows.map((e) => e.id)),
  ]);
  return rows.map(({ cover_path, host_id, ...e }) => ({
    ...e,
    coverUrl: url(db, "covers", cover_path),
    host: people.get(host_id) ?? null,
    likes: likes.get(e.id) ?? 0,
  }));
}

export async function getEventLikes(db: Client, id: string) {
  return (await likeCounts(db, "event", [id])).get(id) ?? 0;
}

export type WorkCard = { id: string; title: string; description: string | null; published_at: string | null; imageUrl: string | null; alt: string; width: number | null; height: number | null; artist: Person | null };

/** Most recently published works with their display image. */
export async function getRecentWorks(db: Client, opts: { limit: number; profileIds?: string[] }): Promise<WorkCard[]> {
  let q = db
    .from("portfolio_items")
    .select("id, title, description, published_at, profile_id")
    .eq("published", true)
    .order("published_at", { ascending: false })
    .limit(opts.limit);
  if (opts.profileIds) q = q.in("profile_id", opts.profileIds);
  const { data: items } = await q;
  if (!items?.length) return [];
  const [{ data: media }, people] = await Promise.all([
    db
      .from("media_assets")
      .select("portfolio_item_id, path, alt_text, width, height, bucket, content_type, position")
      .in("portfolio_item_id", items.map((i) => i.id))
      .in("bucket", ["media", "covers"])
      .like("content_type", "image/%")
      .order("position"),
    getPeople(db, items.map((i) => i.profile_id)),
  ]);
  return items.map(({ profile_id, ...item }) => {
    const m = (media ?? []).find((a) => a.portfolio_item_id === item.id);
    return {
      ...item,
      imageUrl: m ? url(db, m.bucket, m.path) : null,
      alt: m?.alt_text ?? item.title,
      width: m?.width ?? null,
      height: m?.height ?? null,
      artist: people.get(profile_id) ?? null,
    };
  });
}

/** Artists ordered by the 7-day trending view (FR-DIS trending, preview). */
export async function getTrendingArtists(db: Client, limit: number): Promise<(Person & { coverUrl: string | null })[]> {
  const { data } = await db
    .from("trending_artists")
    .select("id")
    .order("view_count", { ascending: false })
    .order("published_items", { ascending: false })
    .limit(limit * 2);
  const people = await getPeople(db, (data ?? []).map((r) => r.id));
  // trending_artists is not filtered by publication; getPeople's RLS read is.
  const ranked = (data ?? []).map((r) => people.get(r.id)).filter((p): p is Person => !!p).slice(0, limit);
  const works = await getRecentWorks(db, { limit: 50, profileIds: ranked.map((p) => p.id) });
  return ranked.map((p) => ({ ...p, coverUrl: works.find((w) => w.artist?.id === p.id)?.imageUrl ?? null }));
}

/** Ids among `ids` the signed-in member has liked (RLS: own rows only). */
export async function getMyLikes(db: Client, type: string, ids: string[]): Promise<Set<string>> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !ids.length) return new Set();
  const { data } = await db.from("interactions").select("subject_id").eq("subject_type", type).in("subject_id", ids);
  return new Set((data ?? []).map((r) => r.subject_id as string));
}
