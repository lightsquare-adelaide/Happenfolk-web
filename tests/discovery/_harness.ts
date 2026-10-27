import { afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  admin,
  anonClient,
  createPortfolioItem,
  createUser as createAccessUser,
  stackConfig,
  type ItemRow,
  type TestUser,
} from "../access/_harness";

/**
 * Harness for the S1 discovery rule tests (migration
 * 20261027000100_discovery_trending_search.sql).
 *
 * Conventions inherited from tests/access (see tests/access/_harness.ts):
 * - Per-user Supabase clients only; RLS is genuinely exercised. The
 *   admin `pg` connection exists for FIXTURE view injection (fixed
 *   page_views timestamps), cleanup, and the red-guard flips — never
 *   for assertions.
 * - Fixture rows owned by a user are created through that user's own
 *   client, so the tests fail if a policy grows teeth in the wrong place.
 * - Red-green: run with DISCOVERY_RED=<guard> to break one protection;
 *   the guarded spec must FAIL. Run without it to see the suite pass.
 * - Run serially: `npm run test:discovery` uses --no-file-parallelism
 *   (shared local stack fixtures, same as events/portfolio suites).
 *
 * Fixture shape: artists in Music (id 1) and Film (id 6) — the closed
 * seven-category list seeded by migration 0002. Film events out-trend
 * music events (3 recent views each vs 1), so the affinity rerank spec
 * can only pass when likes REALLY multiply against genuine momentum.
 * A private (unpublished-profile) artist carries a published item to
 * pin the owner-privacy rule of search_items.
 */

export { admin, anonClient, createPortfolioItem, stackConfig };
export type { TestUser };

export const MUSIC = 1;
export const FILM = 6;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export { runId };

// ---------------- event fixtures ----------------

export type EventFixture = { id: string; title: string; categoryId: number };

/** Creates an event through the host's own client (RLS-checked path). */
export async function createEvent(
  host: TestUser,
  title: string,
  categoryId: number,
  status: "draft" | "published" | "cancelled" = "published",
  startsInHours = 24,
): Promise<EventFixture> {
  const { data, error } = await host.client
    .from("events")
    .insert({
      host_id: host.userId,
      category_id: categoryId,
      title,
      description: `${title} description`,
      status,
      price_cents: 0,
      starts_at: new Date(Date.now() + startsInHours * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + (startsInHours + 2) * 3600 * 1000).toISOString(),
      location: `${title} venue`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`event fixture failed: ${error?.message}`);
  return { id: data.id as string, title, categoryId };
}

/** Publishes (or keeps private) a profile through its own client. */
export async function publishProfile(
  user: TestUser,
  displayName: string,
  categoryId: number,
  published: boolean,
): Promise<void> {
  const { error } = await user.client
    .from("profiles")
    .update({ display_name: displayName, category_id: categoryId, published })
    .eq("id", user.userId);
  if (error) throw new Error(`profile publish failed: ${error.message}`);
}

/**
 * Injects page_views rows with FIXED ages, directly as admin. This is
 * fixture data, not behaviour under test: record_page_view's dedupe
 * window would (correctly) swallow bulk backdated views, and the
 * trending score needs deterministic ages, not wall-clock accidents.
 */
export async function injectViews(
  subjectType: "event" | "profile" | "portfolio_item",
  subjectId: string,
  agesMinutes: number[],
): Promise<void> {
  const a = await admin();
  const values = agesMinutes
    .map(
      (m) =>
        `('${subjectType}', '${subjectId}', null, now() - interval '${m} minutes')`,
    )
    .join(",");
  await a.query(
    `insert into public.page_views (subject_type, subject_id, viewer_id, viewed_at) values ${values}`,
  );
}

// ---------------- shared fixture bundle ----------------

export type DiscoveryFixtures = {
  musician: TestUser; // published, Music
  filmmaker: TestUser; // published, Film
  privateArtist: TestUser; // UNPUBLISHED profile with a published item
  recentEvent: EventFixture; // Music, 1 view 1h ago (high score, low count)
  oldEvent: EventFixture; // Music, 3 views 6d ago (low score, high count)
  cancelledEvent: EventFixture; // Music, cancelled, heavy recent views
  draftEvent: EventFixture; // Music, draft, heavy recent views
  musicEvents: EventFixture[]; // 6 music events, 1 recent view each
  filmEvents: EventFixture[]; // 3 film events, 3 recent views each
  itemTitle: string; // musician's published item (unique title)
  itemId: string;
  draftItemTitle: string; // musician's DRAFT item (unique title)
  privateItemTitle: string; // private artist's PUBLISHED item (unique title)
  privateItemId: string;
};

let fixtures: DiscoveryFixtures | null = null;
const createdUserIds: string[] = [];
const createdProfileSubjectIds: string[] = [];
const createdEventIds: string[] = [];
const createdItemIds: string[] = [];

/** Register each successful account before another fixture operation can fail. */
export async function createUser(label: string): Promise<TestUser> {
  const user = await createAccessUser(label);
  createdUserIds.push(user.userId);
  createdProfileSubjectIds.push(user.userId);
  return user;
}

/** Idempotent fixture load (single process per file, serial suite). */
export async function loadFixtures(): Promise<DiscoveryFixtures> {
  if (fixtures) return fixtures;

  const musician = await createUser(`disc-musician-${runId}`);
  const filmmaker = await createUser(`disc-filmmaker-${runId}`);
  const privateArtist = await createUser(`disc-private-${runId}`);

  await publishProfile(musician, `Discoverable Musician ${runId}`, MUSIC, true);
  await publishProfile(filmmaker, `Discoverable Filmmaker ${runId}`, FILM, true);
  await publishProfile(privateArtist, `Hidden Artist ${runId}`, MUSIC, false);

  // Decay pair: one recent low-count view beats three week-old views.
  const recentEvent = await createEvent(
    musician,
    `Recent Discovery Gig ${runId}`,
    MUSIC,
    "published",
    12,
  );
  const oldEvent = await createEvent(
    musician,
    `Aged Discovery Gig ${runId}`,
    MUSIC,
    "published",
    36,
  );
  // Excluded statuses, loaded with heavy recent views so any leak flips
  // the ordering assertions loudly.
  const cancelledEvent = await createEvent(
    musician,
    `Cancelled Discovery Gig ${runId}`,
    MUSIC,
    "cancelled",
    12,
  );
  const draftEvent = await createEvent(
    musician,
    `Draft Discovery Gig ${runId}`,
    MUSIC,
    "draft",
    12,
  );

  const musicEvents: EventFixture[] = [];
  for (let i = 0; i < 6; i += 1) {
    musicEvents.push(
      await createEvent(musician, `Music Discovery Event ${runId} ${i}`, MUSIC, "published", 24 + i),
    );
  }
  const filmEvents: EventFixture[] = [];
  for (let i = 0; i < 3; i += 1) {
    filmEvents.push(
      await createEvent(filmmaker, `Film Discovery Event ${runId} ${i}`, FILM, "published", 48 + i),
    );
  }
  createdEventIds.push(
    recentEvent.id,
    oldEvent.id,
    cancelledEvent.id,
    draftEvent.id,
    ...musicEvents.map((e) => e.id),
    ...filmEvents.map((e) => e.id),
  );

  // Published + draft items for the musician (createPortfolioItem walks
  // the legal draft -> media -> publish path, migration 20261026000300).
  const itemTitle = `Qwerty Discovery Fixture ${runId}`;
  const item: ItemRow = await createPortfolioItem(musician, itemTitle, true);
  const draftItemTitle = `Draft Discovery Fixture ${runId}`;
  const draftItem: ItemRow = await createPortfolioItem(musician, draftItemTitle, false);
  const privateItemTitle = `Hidden Owner Discovery Fixture ${runId}`;
  const privateItem: ItemRow = await createPortfolioItem(privateArtist, privateItemTitle, true);
  createdItemIds.push(item.id, draftItem.id, privateItem.id);

  // Fixed-age view fixtures (minutes):
  //   recentEvent  1 view @ 1h                -> score ~0.97, count 1
  //   oldEvent     3 views @ 6d               -> score ~0.37, count 3
  //   cancelled/draft 10 fresh views each     -> must never surface
  //   musicEvents  1 view each, 1..6 min ago  -> distinct nonzero scores
  //   filmEvents   3 views each, 13.. min ago -> film out-trends music
  //   musician profile 2 views @ 2h/3h        -> aggregate-independence spec
  await injectViews("event", recentEvent.id, [60]);
  await injectViews("event", oldEvent.id, [6 * 24 * 60, 6 * 24 * 60 + 1, 6 * 24 * 60 + 2]);
  await injectViews("event", cancelledEvent.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await injectViews("event", draftEvent.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let i = 0; i < musicEvents.length; i += 1) {
    await injectViews("event", musicEvents[i].id, [i + 1]);
  }
  for (let i = 0; i < filmEvents.length; i += 1) {
    await injectViews("event", filmEvents[i].id, [13 + i * 3, 14 + i * 3, 15 + i * 3]);
  }
  await injectViews("profile", musician.userId, [120, 180]);

  fixtures = {
    musician,
    filmmaker,
    privateArtist,
    recentEvent,
    oldEvent,
    cancelledEvent,
    draftEvent,
    musicEvents,
    filmEvents,
    itemTitle,
    itemId: item.id,
    draftItemTitle,
    privateItemTitle,
    privateItemId: privateItem.id,
  };
  return fixtures;
}

// ---------------- cleanup (own fixtures only) ----------------

/**
 * Deletes exactly what this module created: its page_views rows, its
 * auth users (cascading profiles -> events -> portfolio_items ->
 * media_assets), nothing else. Registered once per spec file via the
 * top-level afterAll below.
 */
export async function cleanupFixtures(): Promise<void> {
  const a = await admin();
  // Include subjects created before a later setup step failed. page_views has
  // polymorphic subject IDs, so deleting an auth user alone cannot remove them.
  const owned = await a.query<{ id: string }>(
    `select id from public.events where host_id = any ($1::uuid[])
     union select id from public.portfolio_items where profile_id = any ($1::uuid[])`,
    [createdUserIds],
  );
  const subjectIds = [...new Set([
    ...createdEventIds, ...createdItemIds, ...createdProfileSubjectIds,
    ...owned.rows.map((row) => row.id),
  ])];
  if (subjectIds.length > 0) {
    await a.query(
      `delete from public.page_views where subject_id = any ($1::uuid[])`,
      [subjectIds],
    );
  }
  for (const uid of createdUserIds) {
    // Cascade removes profile, events, items, media, interactions and
    // nulls page_views.viewer_id for this user.
    await a.query(`delete from auth.users where id = $1`, [uid]);
  }
  const remaining = await a.query<{ count: string }>(
    `select (
       (select count(*) from auth.users where id = any ($1::uuid[])) +
       (select count(*) from public.profiles where id = any ($1::uuid[])) +
       (select count(*) from public.events where host_id = any ($1::uuid[])) +
       (select count(*) from public.portfolio_items where profile_id = any ($1::uuid[])) +
       (select count(*) from public.page_views where subject_id = any ($2::uuid[]))
     )::text as count`,
    [createdUserIds, subjectIds],
  );
  if (remaining.rows[0].count !== "0") {
    throw new Error(`Discovery fixture cleanup left ${remaining.rows[0].count} scoped rows`);
  }
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await cleanupFixtures();
  }
});

// ---------------- red guards (DISCOVERY_RED=<name>) ----------------

type Guard = { name: string; breakSql: string; restoreSql: string };

const TRENDING_EVENTS_SQL = `
create or replace view public.trending_events as
select
  e.id, e.host_id, e.category_id, e.title, e.starts_at, e.price_cents,
  coalesce(pv.view_count, 0)::bigint as view_count,
  coalesce(pv.trending_score, 0)::float8 as trending_score
from public.events e
left join lateral (
  select count(*) as view_count,
         sum(exp(-ln(2) / 2.0 * (extract(epoch from (now() - x.viewed_at)) / 86400.0))) as trending_score
  from public.page_views x
  where x.subject_type = 'event' and x.subject_id = e.id
    and x.viewed_at > now() - interval '7 days'
) pv on true
where e.status = 'published'
order by trending_score desc, view_count desc, e.starts_at asc, e.id asc;
`;

const TRENDING_ARTISTS_SQL = `
create or replace view public.trending_artists as
select
  p.id, p.handle, p.display_name, p.category_id, p.avatar_path,
  coalesce(pi.published_items, 0)::bigint as published_items,
  coalesce(pv.view_count, 0)::bigint as view_count,
  coalesce(pv.trending_score, 0)::float8 as trending_score
from public.profiles p
left join lateral (
  select count(*) as view_count,
         sum(exp(-ln(2) / 2.0 * (extract(epoch from (now() - x.viewed_at)) / 86400.0))) as trending_score
  from public.page_views x
  where x.subject_type = 'profile' and x.subject_id = p.id
    and x.viewed_at > now() - interval '7 days'
) pv on true
left join lateral (
  select count(*) as published_items
  from public.portfolio_items i
  where i.profile_id = p.id and i.published
) pi on true
where p.published
order by trending_score desc, view_count desc, p.handle asc, p.id asc;
`;

const RECOMMENDED_EVENTS_SQL = `
create or replace view public.recommended_events
with (security_invoker = true) as
select
  e.id, e.host_id, e.category_id, e.title, e.description, e.starts_at,
  e.ends_at, e.price_cents, e.capacity, e.cover_path,
  coalesce(t.view_count, 0)::bigint as view_count,
  coalesce(ca.affinity, 0)::bigint as affinity,
  coalesce(t.trending_score, 0)::float8 as trending_score
from public.events e
left join public.trending_events t on t.id = e.id
left join public.category_affinity ca
  on ca.category_id = e.category_id and ca.member_id = auth.uid ()
where e.status = 'published'
order by
  coalesce(t.trending_score, 0) * (1 + 2 * coalesce(ca.affinity, 0)) desc,
  coalesce(t.view_count, 0) desc,
  e.starts_at asc,
  e.id asc;
`;

const SEARCH_ITEMS_SQL = `
create or replace function public.search_items (
  p_query text, p_category_id smallint default null, p_limit integer default 24
)
returns table (id uuid, title text, profile_id uuid, category_id smallint)
language plpgsql stable set search_path = public
as $fn$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 100);
begin
  if v_query is not null and octet_length(v_query) > 200 then
    raise exception 'QUERY_TOO_LONG';
  end if;
  return query
  select pi.id, pi.title, pi.profile_id, p.category_id
  from public.portfolio_items pi
  join public.profiles p on p.id = pi.profile_id
  where pi.published and p.published
    and (p_category_id is null or p.category_id = p_category_id)
    and (
      v_query is null
      or pi.search_vector @@ websearch_to_tsquery('english', unaccent(v_query))
      or similarity(unaccent(pi.title), unaccent(v_query)) > 0.3
    )
  order by
    case when v_query is null then 0
      else ts_rank(pi.search_vector, websearch_to_tsquery('english', unaccent(v_query))) end desc,
    coalesce(similarity(unaccent(pi.title), unaccent(v_query)), 0) desc,
    pi.title asc, pi.id asc
  limit v_limit;
end;
$fn$;
`;

const guards: Guard[] = [
  {
    // Score degenerates to the raw count: the 6-day-old 3-view event then
    // outranks the 1-hour-old 1-view event and 01 must fail.
    name: "score-decay-off",
    breakSql: `
create or replace view public.trending_events as
select
  e.id, e.host_id, e.category_id, e.title, e.starts_at, e.price_cents,
  coalesce(pv.view_count, 0)::bigint as view_count,
  coalesce(pv.view_count, 0)::float8 as trending_score
from public.events e
left join lateral (
  select count(*) as view_count
  from public.page_views x
  where x.subject_type = 'event' and x.subject_id = e.id
    and x.viewed_at > now() - interval '7 days'
) pv on true
where e.status = 'published'
order by trending_score desc, view_count desc, e.starts_at asc, e.id asc;`,
    restoreSql: TRENDING_EVENTS_SQL,
  },
  {
    // The personal-version defect: page_views and portfolio_items in ONE
    // aggregate, so every profile view is multiplied by the item count.
    // Publishing a second work then doubles view_count/score and 02 must fail.
    name: "artist-join-multiply",
    breakSql: `
create or replace view public.trending_artists as
select
  p.id, p.handle, p.display_name, p.category_id, p.avatar_path,
  count(distinct pi.id)::bigint as published_items,
  count(pv.id) filter (where pv.viewed_at > now() - interval '7 days')::bigint as view_count,
  coalesce(sum(
    exp(-ln(2) / 2.0 * (extract(epoch from (now() - pv.viewed_at)) / 86400.0))
  ) filter (where pv.viewed_at > now() - interval '7 days'), 0)::float8 as trending_score
from public.profiles p
left join public.page_views pv
  on pv.subject_type = 'profile' and pv.subject_id = p.id
left join public.portfolio_items pi
  on pi.profile_id = p.id and pi.published
where p.published
group by p.id
order by trending_score desc, view_count desc, p.handle asc, p.id asc;`,
    restoreSql: TRENDING_ARTISTS_SQL,
  },
  {
    // Degenerate rerank: affinity term removed, pure trending order —
    // likes then change nothing and 03 must fail.
    name: "affinity-off",
    breakSql: `
create or replace view public.recommended_events
with (security_invoker = true) as
select
  e.id, e.host_id, e.category_id, e.title, e.description, e.starts_at,
  e.ends_at, e.price_cents, e.capacity, e.cover_path,
  coalesce(t.view_count, 0)::bigint as view_count,
  coalesce(ca.affinity, 0)::bigint as affinity,
  coalesce(t.trending_score, 0)::float8 as trending_score
from public.events e
left join public.trending_events t on t.id = e.id
left join public.category_affinity ca
  on ca.category_id = e.category_id and ca.member_id = auth.uid ()
where e.status = 'published'
order by
  coalesce(t.trending_score, 0) desc,
  coalesce(t.view_count, 0) desc,
  e.starts_at asc,
  e.id asc;`,
    restoreSql: RECOMMENDED_EVENTS_SQL,
  },
  {
    // search_items forgets the owning profile's published flag: the
    // private artist's item leaks through discovery and 04 must fail.
    name: "search-owner-blind",
    breakSql: SEARCH_ITEMS_SQL.replace(
      "where pi.published and p.published",
      "where pi.published",
    ),
    restoreSql: SEARCH_ITEMS_SQL,
  },
];

/**
 * In red mode, applies the matching guard and returns its restore thunk
 * (call it in afterAll). Returns null in green mode.
 */
export async function applyDiscoveryRedGuard(): Promise<(() => Promise<void>) | null> {
  const red = process.env.DISCOVERY_RED;
  if (!red) return null;
  const g = guards.find((x) => x.name === red);
  if (!g) {
    throw new Error(
      `DISCOVERY_RED=${red} matches no guard (have: ${guards.map((x) => x.name).join(", ")})`,
    );
  }
  const a = await admin();
  await a.query(g.breakSql);
  return async () => {
    await (await admin()).query(g.restoreSql);
  };
}

/** Reads one trending/recommended view through a real client, no ORDER BY. */
export async function readViewIds(
  client: SupabaseClient,
  view: string,
): Promise<string[]> {
  const { data, error } = await client.from(view).select("id");
  if (error) throw new Error(`read ${view} failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
