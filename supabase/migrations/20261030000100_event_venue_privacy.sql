-- D5: public summaries remain discoverable; exact venues and full descriptions
-- require sign-in. Column grants also prevent REST filters, ordering, embeds
-- and GraphQL from reading the stored private fields directly.
revoke select on public.events from anon, public;
revoke select (location, description, search_vector) on public.events from anon, public;
grant select (id, host_id, category_id, title, status, starts_at, ends_at,
  price_cents, capacity, cover_path, created_at, updated_at, open_to_collaborate,
  is_hidden) on public.events to anon;

-- This owner-evaluated view is an intentional column-privacy boundary.
-- It repeats the PUBLIC visibility arm explicitly, exposes no search vector,
-- and is read-only for API callers. Private team previews still use events
-- with the existing authenticated RLS policies.
create view public.public_events with (security_barrier = true) as
select e.id, e.host_id, e.category_id, e.title,
  case when auth.uid() is not null or auth.role() = 'service_role'
    then e.description else null end as description,
  e.status, e.starts_at, e.ends_at, e.price_cents, e.capacity, e.cover_path,
  e.created_at, e.updated_at,
  case when auth.uid() is not null or auth.role() = 'service_role'
    then e.location else null end as location,
  e.open_to_collaborate, e.is_hidden
from public.events e
where e.status = 'published' and not e.is_hidden;
revoke all on public.public_events from public, anon, authenticated;
grant select on public.public_events to anon, authenticated, service_role;

-- Preserve the existing recommendation signature while masking its description.
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
from public.public_events e
left join public.trending_events t on t.id = e.id
left join public.category_affinity ca
  on ca.category_id = e.category_id and ca.member_id = auth.uid ()
where e.status = 'published'
  and not e.is_hidden
order by
  coalesce(t.trending_score, 0) * (1 + 2 * coalesce(ca.affinity, 0)) desc,
  coalesce(t.view_count, 0) desc,
  e.starts_at asc,
  e.id asc;

-- Search needs the private search vector for relevance, so this bounded,
-- static query runs as owner, explicitly filters public rows, and masks venues.
create or replace function public.search_events (
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
security definer
set search_path = public, extensions
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
    case when auth.uid() is not null or auth.role() = 'service_role' then e.location else null end,
    e.price_cents,
    e.cover_path
  from public.events e
  where e.status = 'published'
    and not e.is_hidden
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

revoke execute on function public.search_events(text, smallint, integer) from public;
grant execute on function public.search_events(text, smallint, integer) to anon, authenticated, service_role;

