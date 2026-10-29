-- 20261028200200: admin hiding and internal staff operations, adapted to the
-- Happenfolk team schema and 20261027000100 discovery views/search RPCs.
--
-- 1) is_hidden lands on profiles, portfolio_items and events.
-- 2) Public SELECT policies on profiles, portfolio_items, events and media_assets
--    tighten their world-readable arm with `not is_hidden` while keeping owner
--    and collaborator arms untouched.
-- 3) The four discovery views (trending_events, trending_artists,
--    recommended_events, recommended_artists) and three bounded search RPCs
--    (search_events, search_artists, search_items) from 20261027000100 are
--    rebuilt with identical column signatures and lateral-aggregate semantics
--    plus `not is_hidden` filters.
-- 4) admin_staff (RLS enabled, zero policies) and SECURITY DEFINER staff RPCs
--    provide the sole privilege boundary for hiding and data corrections.

-- ---------------------------------------------------------------
-- 1) is_hidden columns
-- ---------------------------------------------------------------

alter table public.profiles add column if not exists is_hidden boolean not null default false;
alter table public.portfolio_items add column if not exists is_hidden boolean not null default false;
alter table public.events add column if not exists is_hidden boolean not null default false;

-- ---------------------------------------------------------------
-- 2) Read policies: public arm tightened, owner/collaborator arms preserved.
-- ---------------------------------------------------------------

drop policy "published profiles are world-readable" on public.profiles;
create policy "published profiles are world-readable"
  on public.profiles for select
  to anon, authenticated
  using ((published and not is_hidden) or id = auth.uid ());

drop policy "published portfolio items are world-readable" on public.portfolio_items;
create policy "published portfolio items are world-readable"
  on public.portfolio_items for select
  to anon, authenticated
  using ((published and not is_hidden) or profile_id = auth.uid ());

drop policy "published items media is world-readable" on public.media_assets;
create policy "published items media is world-readable"
  on public.media_assets for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.portfolio_items pi
      where pi.id = portfolio_item_id
        and ((pi.published and not pi.is_hidden) or pi.profile_id = auth.uid ())
    )
  );

drop policy "published events are world-readable" on public.events;
create policy "published events are world-readable"
  on public.events for select
  to anon, authenticated
  using (
    (status = 'published' and not is_hidden)
    or host_id = auth.uid ()
    or public.is_event_collaborator (id, auth.uid ())
  );

-- ---------------------------------------------------------------
-- 3) Discovery views and search RPCs (adapted from 20261027000100)
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
  and not e.is_hidden
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
    and not i.is_hidden
) pi on true
where p.published
  and not p.is_hidden
order by
  trending_score desc,
  view_count desc,
  p.handle asc,
  p.id asc;

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
  and not e.is_hidden
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
  and not p.is_hidden
order by
  coalesce(t.trending_score, 0) * (1 + 2 * coalesce(ca.affinity, 0)) desc,
  coalesce(t.view_count, 0) desc,
  p.handle asc,
  p.id asc;

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

create or replace function public.search_artists (
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
    and not p.is_hidden
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

create or replace function public.search_items (
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
    and not pi.is_hidden
    and not p.is_hidden
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

grant execute on function public.search_events (text, smallint, integer) to anon, authenticated;
grant execute on function public.search_artists (text, smallint, integer) to anon, authenticated;
grant execute on function public.search_items (text, smallint, integer) to anon, authenticated;

-- ---------------------------------------------------------------
-- 4) admin_staff + staff-gated definer operations + toggle_like
-- ---------------------------------------------------------------

create or replace function public.toggle_like (p_subject_type text, p_subject_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid ();
  v_ok boolean;
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to like';
  end if;
  if p_subject_type not in ('event', 'profile', 'portfolio_item') then
    raise exception 'UNKNOWN_SUBJECT_TYPE: %', p_subject_type;
  end if;

  v_ok :=
    case p_subject_type
      when 'event' then
        exists (select 1 from public.events e
                where e.id = p_subject_id and e.status = 'published' and not e.is_hidden)
      when 'profile' then
        exists (select 1 from public.profiles p
                where p.id = p_subject_id and p.published and not p.is_hidden)
      when 'portfolio_item' then
        exists (select 1 from public.portfolio_items pi
                where pi.id = p_subject_id and pi.published and not pi.is_hidden)
    end;
  if not v_ok then
    raise exception 'SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED';
  end if;

  if exists (
    select 1 from public.interactions i
    where i.member_id = v_member
      and i.subject_type = p_subject_type
      and i.subject_id = p_subject_id
      and i.kind = 'like'
  ) then
    delete from public.interactions i
    where i.member_id = v_member
      and i.subject_type = p_subject_type
      and i.subject_id = p_subject_id
      and i.kind = 'like';
    return false;
  end if;

  insert into public.interactions (member_id, subject_type, subject_id, kind)
  values (v_member, p_subject_type, p_subject_id, 'like');
  return true;
end;
$$;

grant execute on function public.toggle_like (text, uuid) to authenticated;

create table if not exists public.admin_staff (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now ()
);

alter table public.admin_staff enable row level security;

-- Zero policies keep admin_staff unreadable and unwritable by clients;
-- granting table SELECT mirrors page_views (20261013000100) so API reads
-- return an empty set rather than a table-privilege error.
grant select on public.admin_staff to anon, authenticated;

comment on table public.admin_staff is
  'Internal staff register. RLS on, zero policies: clients can neither read nor write it; staff checks run inside SECURITY DEFINER functions.';

create or replace function public.is_staff ()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_staff s
    where s.member_id = auth.uid ()
  );
$$;

revoke execute on function public.is_staff () from public;
grant execute on function public.is_staff () to anon, authenticated;

-- Prevent non-staff clients from mutating is_hidden directly on their own rows.
create or replace function public.guard_is_hidden ()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_hidden
       and current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not public.is_staff () then
      raise exception 'ADMIN_REQUIRED: internal staff only' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_hidden is distinct from old.is_hidden
       and current_user not in ('postgres', 'supabase_admin', 'service_role')
       and not public.is_staff () then
      raise exception 'ADMIN_REQUIRED: internal staff only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_is_hidden () from public, anon, authenticated;

create trigger trg_profiles_guard_is_hidden
  before insert or update of is_hidden on public.profiles
  for each row execute function public.guard_is_hidden ();

create trigger trg_portfolio_items_guard_is_hidden
  before insert or update of is_hidden on public.portfolio_items
  for each row execute function public.guard_is_hidden ();

create trigger trg_events_guard_is_hidden
  before insert or update of is_hidden on public.events
  for each row execute function public.guard_is_hidden ();

create or replace function public.admin_set_hidden (
  p_subject_type text,
  p_subject_id uuid,
  p_hidden boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff () then
    raise exception 'ADMIN_REQUIRED: internal staff only';
  end if;
  if p_subject_type not in ('event', 'profile', 'portfolio_item') then
    raise exception 'UNKNOWN_SUBJECT_TYPE: %', p_subject_type;
  end if;

  case p_subject_type
    when 'event' then
      update public.events set is_hidden = p_hidden where id = p_subject_id;
    when 'profile' then
      update public.profiles set is_hidden = p_hidden where id = p_subject_id;
    when 'portfolio_item' then
      update public.portfolio_items set is_hidden = p_hidden where id = p_subject_id;
  end case;
  if not found then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.admin_update_profile (
  p_member_id uuid,
  p_display_name text,
  p_bio text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff () then
    raise exception 'ADMIN_REQUIRED: internal staff only';
  end if;
  update public.profiles
  set
    display_name = coalesce(p_display_name, display_name),
    bio = coalesce(p_bio, bio)
  where id = p_member_id;
  if not found then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.admin_update_item (
  p_item_id uuid,
  p_title text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff () then
    raise exception 'ADMIN_REQUIRED: internal staff only';
  end if;
  update public.portfolio_items
  set
    title = coalesce(p_title, title),
    description = coalesce(p_description, description)
  where id = p_item_id;
  if not found then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.admin_update_event (
  p_event_id uuid,
  p_title text,
  p_description text,
  p_location text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff () then
    raise exception 'ADMIN_REQUIRED: internal staff only';
  end if;
  update public.events
  set
    title = coalesce(p_title, title),
    description = coalesce(p_description, description),
    location = coalesce(p_location, location)
  where id = p_event_id;
  if not found then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function
  public.admin_set_hidden (text, uuid, boolean),
  public.admin_update_profile (uuid, text, text),
  public.admin_update_item (uuid, text, text),
  public.admin_update_event (uuid, text, text, text)
from public, anon;

grant execute on function
  public.admin_set_hidden (text, uuid, boolean),
  public.admin_update_profile (uuid, text, text),
  public.admin_update_item (uuid, text, text),
  public.admin_update_event (uuid, text, text, text)
to authenticated;
