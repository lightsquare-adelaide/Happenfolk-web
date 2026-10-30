-- Forward fixes for the inherited Task B migrations. Existing migrations stay
-- immutable. All changes tighten public visibility or serialize maintenance.

-- One predicate shared by aggregate policies and likes. Definer rights avoid
-- the owner's private preview arm making a hidden subject publicly countable.
create function public.subject_is_public (p_subject_type text, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_subject_type
    when 'profile' then exists (
      select 1 from public.profiles p
      where p.id = p_subject_id and p.published and not p.is_hidden
    )
    when 'portfolio_item' then exists (
      select 1 from public.portfolio_items i
      join public.profiles p on p.id = i.profile_id
      where i.id = p_subject_id and i.published and not i.is_hidden
        and p.published and not p.is_hidden
    )
    when 'event' then exists (
      select 1 from public.events e
      where e.id = p_subject_id and e.status = 'published' and not e.is_hidden
    )
    else false
  end;
$$;
revoke execute on function public.subject_is_public (text, uuid) from public;
grant execute on function public.subject_is_public (text, uuid) to anon, authenticated, service_role;

create or replace view public.like_counts as
select subject_type, subject_id, count(*) as like_count
from public.interactions
where kind = 'like' and public.subject_is_public(subject_type, subject_id)
group by subject_type, subject_id;

drop policy "monthly view totals are public" on public.page_views_monthly;
create policy "monthly view totals are public"
  on public.page_views_monthly for select to anon, authenticated
  using (public.subject_is_public(subject_type, subject_id));

-- Preserve own-row reads and deletes, but prevent direct client inserts from
-- bypassing the published-subject gate in toggle_like.
drop policy "members like as themselves" on public.interactions;
create policy "members like as themselves"
  on public.interactions for insert to authenticated
  with check (member_id = auth.uid() and public.subject_is_public(subject_type, subject_id));

create or replace function public.toggle_like (p_subject_type text, p_subject_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'AUTH_REQUIRED: sign in to like';
  end if;
  if p_subject_type is null or p_subject_type not in ('event', 'profile', 'portfolio_item') then
    raise exception 'UNKNOWN_SUBJECT_TYPE';
  end if;
  if not public.subject_is_public(p_subject_type, p_subject_id) then
    raise exception 'SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED';
  end if;

  -- Serialize the same member/subject toggle so concurrent requests cannot
  -- fail with a unique violation or accumulate duplicate likes.
  perform pg_advisory_xact_lock(hashtextextended(
    v_member::text || ':' || p_subject_type || ':' || p_subject_id::text, 28200400
  ));
  delete from public.interactions
  where member_id = v_member and subject_type = p_subject_type
    and subject_id = p_subject_id and kind = 'like';
  if found then return false; end if;
  insert into public.interactions (member_id, subject_type, subject_id, kind)
  values (v_member, p_subject_type, p_subject_id, 'like');
  return true;
end;
$$;
revoke execute on function public.toggle_like (text, uuid) from public, anon;
grant execute on function public.toggle_like (text, uuid) to authenticated;

create or replace function public.run_page_view_retention (
  p_retain interval default interval '90 days'
)
returns table (archived_rows bigint, purged_rows bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - p_retain;
  v_archived bigint;
  v_purged bigint;
begin
  if p_retain is null or p_retain <= interval '0 days' then
    raise exception 'RETENTION_WINDOW_MUST_BE_POSITIVE';
  end if;
  -- Operators and pg_cron can overlap. Only one archive/purge pair may run
  -- at a time, otherwise the same raw rows could be counted twice.
  perform pg_advisory_xact_lock(28200300);
  insert into public.page_views_monthly
    (subject_type, subject_id, view_month, view_count)
  select pv.subject_type, pv.subject_id,
    (date_trunc('month', pv.viewed_at at time zone 'UTC'))::date, count(*)
  from public.page_views pv
  where pv.viewed_at < v_cutoff
  group by pv.subject_type, pv.subject_id,
    (date_trunc('month', pv.viewed_at at time zone 'UTC'))::date
  on conflict (subject_type, subject_id, view_month) do update
    set view_count = public.page_views_monthly.view_count + excluded.view_count;
  get diagnostics v_archived = row_count;
  v_purged := public.purge_page_views_before(v_cutoff);
  return query select v_archived, v_purged;
end;
$$;
revoke execute on function public.run_page_view_retention (interval) from public, anon, authenticated;
grant execute on function public.run_page_view_retention (interval) to service_role;
