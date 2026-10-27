-- 20261027000100: S1 discovery — time-decayed trending scores, multiplicative
-- recommendation rerank, and bounded discovery search RPCs.
--
-- Ported selectively from the personal-version 0020_discovery_trending_
-- recommendations.sql (Lightsquare-frontend / ArtLink-web feat/discovery).
-- What is deliberately NOT ported:
--   * Section 3 of the source replaces record_page_view with member-day /
--     anonymous-global-velocity throttling. That would ERASE this repo's
--     per-identity dedupe (20261026000600: 30-minute window, subject-scoped
--     visitor hash, transaction advisory lock) and its grants. F's recorder,
--     page_view_dedupe_window(), page_view_visitor_hash() and all grants
--     stay exactly as they are.
--   * Section 5's purge_page_views_before() retention hook — out of scope.
--   * The source trending_artists join defect (see below) — fixed here.
--
-- Trending score. The team views ranked by a raw 7-day count with no
-- ORDER BY at all, so "trending" was insertion order. The score is the
-- 7-day view sum with exponential freshness decay: each view contributes
-- exp(-lambda * age_days), lambda = ln(2)/2, i.e. a 48-hour half-life.
-- A week-old view still carries ~9% weight (the window edge is not a
-- cliff) while yesterday's spike visibly outranks last week's plateau.
-- Tiebreaks are deterministic: score, then raw count, then a stable
-- natural key (starts_at/handle), then the row id.
--
-- Artist aggregate defect fixed. The personal trending_artists view joins
-- page_views and published portfolio_items in ONE aggregate, so each
-- profile view row is multiplied by the artist's number of published
-- works (score and view_count both inflate with every new item). Here the
-- two aggregates are computed in independent lateral subqueries: adding a
-- published work changes published_items only, never view_count or
-- trending_score for the same page-view rows. tests/discovery/02 pins
-- this regression.
--
-- Rerank. recommended_* becomes score x (1 + 2 x affinity) instead of the
-- 0009 lexicographic order (where any nonzero affinity in one category
-- steam-rolled every hot item of every other category). The tiebreak
-- chain is byte-identical to the trending views', so a cold start
-- (affinity = 0 everywhere => multiplier exactly 1) yields the global
-- trending sequence item for item. Affinity identity stays auth.uid()
-- via the existing category_affinity join — no caller-selected member.
--
-- Column compatibility. CREATE OR REPLACE VIEW keeps every existing
-- column name, position and type (view_count stays bigint, published_items
-- stays bigint); trending_score (float8) is APPENDED last, so dependent
-- views, the 20261013000100 grants and every existing consumer keep
-- working. Grants are preserved by CREATE OR REPLACE.
--
-- Search. FTS (search_vector, maintained since 0006) plus pg_trgm fuzzy
-- matching over published rows only. SECURITY INVOKER, so RLS still
-- decides row visibility on top of the explicit published predicates —
-- no definer shortcut can leak a private artist's work: search_items
-- requires BOTH pi.published AND the owning profile's published flag, so
-- a private artist's rows are invisible to everyone through discovery,
-- and an owner browsing discovery sees exactly what the public sees
-- (draft preview is the dashboard's job, not discovery's).
-- Inputs are strictly bounded: query length is capped (QUERY_TOO_LONG),
-- limits are clamped to 1..100 with default 24, unknown categories simply
-- match nothing.

-- ---------------------------------------------------------------
-- 1) Trending: scored, ordered, published-only, pre-aggregated.
-- ---------------------------------------------------------------

create or replace view public.trending_events as
select
  e.id,
  e.host_id,
  e.category_id,
  e.title,
  e.starts_at,
  e.price_cents,
  coalesce(pv.view_count, 0)::bigint as view_count,
  coalesce(pv.trending_score, 0)::float8 as trending_score
from public.events e
left join lateral (
  select
    count(*) as view_count,
    sum(
      exp(
        -ln(2) / 2.0
        * (extract(epoch from (now() - x.viewed_at)) / 86400.0)
      )
    ) as trending_score
  from public.page_views x
  where x.subject_type = 'event'
    and x.subject_id = e.id
    and x.viewed_at > now() - interval '7 days'
) pv on true
where e.status = 'published'
order by
  trending_score desc,
  view_count desc,
  e.starts_at asc,
  e.id asc;

create or replace view public.trending_artists as
select
  p.id,
  p.handle,
  p.display_name,
  p.category_id,
  p.avatar_path,
  coalesce(pi.published_items, 0)::bigint as published_items,
  coalesce(pv.view_count, 0)::bigint as view_count,
  coalesce(pv.trending_score, 0)::float8 as trending_score
from public.profiles p
-- Views and item counts are aggregated SEPARATELY (see header): the
-- single-join shape multiplies each view row by the item count.
left join lateral (
  select
    count(*) as view_count,
    sum(
      exp(
        -ln(2) / 2.0
        * (extract(epoch from (now() - x.viewed_at)) / 86400.0)
      )
    ) as trending_score
  from public.page_views x
  where x.subject_type = 'profile'
    and x.subject_id = p.id
    and x.viewed_at > now() - interval '7 days'
) pv on true
left join lateral (
  select count(*) as published_items
  from public.portfolio_items i
  where i.profile_id = p.id
    and i.published
) pi on true
where p.published
order by
  trending_score desc,
  view_count desc,
  p.handle asc,
  p.id asc;

-- ---------------------------------------------------------------
-- 2) Recommended: score x (1 + 2 x affinity), trending-identical
--    tiebreaks so cold start is the global trending order.
--    SECURITY INVOKER, affinity pinned to auth.uid() by the join.
-- ---------------------------------------------------------------

create or replace view public.recommended_events
with (security_invoker = true) as
select
  e.id,
  e.host_id,
  e.category_id,
  e.title,
  e.description,
  e.starts_at,
  e.ends_at,
  e.price_cents,
  e.capacity,
  e.cover_path,
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

create or replace view public.recommended_artists
with (security_invoker = true) as
select
  p.id,
  p.handle,
  p.display_name,
  p.category_id,
  p.avatar_path,
  coalesce(t.published_items, 0)::bigint as published_items,
  coalesce(t.view_count, 0)::bigint as view_count,
  coalesce(ca.affinity, 0)::bigint as affinity,
  coalesce(t.trending_score, 0)::float8 as trending_score
from public.profiles p
left join public.trending_artists t on t.id = p.id
left join public.category_affinity ca
  on ca.category_id = p.category_id and ca.member_id = auth.uid ()
where p.published
order by
  coalesce(t.trending_score, 0) * (1 + 2 * coalesce(ca.affinity, 0)) desc,
  coalesce(t.view_count, 0) desc,
  p.handle asc,
  p.id asc;

-- ---------------------------------------------------------------
-- 3) Discovery search RPCs (FTS + trigram, invoker-side RLS, bounded).
-- ---------------------------------------------------------------
-- plpgsql (not sql) so over-long queries can be rejected explicitly
-- instead of silently truncated. unaccent is STABLE (dictionary lookup),
-- fine inside a stable function; the 0.3 similarity cutoff is pg_trgm's
-- documented default — one or two typos in a realistic title stay above
-- it. websearch_to_tsquery never raises on malformed input, so "!!!&&&"
-- degrades to a trigram-only (usually empty) result instead of an error.

create function public.search_events (
  p_query text,
  p_category_id smallint default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  title text,
  category_id smallint,
  starts_at timestamptz,
  location text,
  price_cents integer,
  cover_path text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 100);
begin
  if v_query is not null and octet_length(v_query) > 200 then
    raise exception 'QUERY_TOO_LONG';
  end if;

  return query
  select
    e.id,
    e.title,
    e.category_id,
    e.starts_at,
    e.location,
    e.price_cents,
    e.cover_path
  from public.events e
  where e.status = 'published'
    and (p_category_id is null or e.category_id = p_category_id)
    and (
      v_query is null
      or e.search_vector @@ websearch_to_tsquery('english', unaccent(v_query))
      or similarity(unaccent(e.title), unaccent(v_query)) > 0.3
    )
  order by
    case
      when v_query is null then 0
      else ts_rank(e.search_vector, websearch_to_tsquery('english', unaccent(v_query)))
    end desc,
    coalesce(similarity(unaccent(e.title), unaccent(v_query)), 0) desc,
    e.starts_at asc,
    e.id asc
  limit v_limit;
end;
$$;

create function public.search_artists (
  p_query text,
  p_category_id smallint default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  handle text,
  display_name text,
  category_id smallint,
  avatar_path text
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 100);
begin
  if v_query is not null and octet_length(v_query) > 200 then
    raise exception 'QUERY_TOO_LONG';
  end if;

  return query
  select
    p.id,
    p.handle,
    p.display_name,
    p.category_id,
    p.avatar_path
  from public.profiles p
  where p.published
    and (p_category_id is null or p.category_id = p_category_id)
    and (
      v_query is null
      or p.search_vector @@ websearch_to_tsquery('english', unaccent(v_query))
      or similarity(unaccent(coalesce(p.display_name, '')), unaccent(v_query)) > 0.3
      or similarity(unaccent(p.handle), unaccent(v_query)) > 0.3
    )
  order by
    case
      when v_query is null then 0
      else ts_rank(p.search_vector, websearch_to_tsquery('english', unaccent(v_query)))
    end desc,
    greatest(
      coalesce(similarity(unaccent(coalesce(p.display_name, '')), unaccent(v_query)), 0),
      coalesce(similarity(unaccent(p.handle), unaccent(v_query)), 0)
    ) desc,
    p.handle asc,
    p.id asc
  limit v_limit;
end;
$$;

create function public.search_items (
  p_query text,
  p_category_id smallint default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  title text,
  profile_id uuid,
  category_id smallint
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 100);
begin
  if v_query is not null and octet_length(v_query) > 200 then
    raise exception 'QUERY_TOO_LONG';
  end if;

  -- Items carry no category of their own; they filter and rank under the
  -- owning artist's category, same as category_affinity resolves them in
  -- 0009. BOTH published flags are required: the item's, and the owning
  -- profile's — a private artist's work is not discoverable by anyone,
  -- and RLS (invoker) additionally hides rows the caller may not see.
  return query
  select
    pi.id,
    pi.title,
    pi.profile_id,
    p.category_id
  from public.portfolio_items pi
  join public.profiles p on p.id = pi.profile_id
  where pi.published
    and p.published
    and (p_category_id is null or p.category_id = p_category_id)
    and (
      v_query is null
      or pi.search_vector @@ websearch_to_tsquery('english', unaccent(v_query))
      or similarity(unaccent(pi.title), unaccent(v_query)) > 0.3
    )
  order by
    case
      when v_query is null then 0
      else ts_rank(pi.search_vector, websearch_to_tsquery('english', unaccent(v_query)))
    end desc,
    coalesce(similarity(unaccent(pi.title), unaccent(v_query)), 0) desc,
    pi.title asc,
    pi.id asc
  limit v_limit;
end;
$$;

-- Explicit grants (default privileges on this project also grant EXECUTE
-- on new public functions to anon/authenticated; stating it keeps the
-- migration self-contained, matching 0006/20261026000600 style).
grant execute on function public.search_events (text, smallint, integer) to anon, authenticated;
grant execute on function public.search_artists (text, smallint, integer) to anon, authenticated;
grant execute on function public.search_items (text, smallint, integer) to anon, authenticated;
