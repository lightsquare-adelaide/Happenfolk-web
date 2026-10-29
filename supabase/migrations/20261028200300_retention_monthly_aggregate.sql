-- 20261028200300: data retention with monthly aggregation (ported from 0023
-- and 0020's purge hook, adapted to the team page_views schema).
--
-- page_views carries (id, subject_type, subject_id, viewer_id, viewed_at,
-- visitor_hash). page_views_monthly keeps ONLY subject_type, subject_id,
-- view_month and view_count — neither viewer_id nor visitor_hash is carried
-- over, so after the 90-day retention run both member attribution and
-- anonymous dedupe hashes are permanently removed.
--
-- Likes (interactions) are retained for the life of the account and are
-- never touched by retention.

-- ----------------------------------------------------------------
-- 1) Monthly aggregate table (RLS on, world-readable totals only)
-- ----------------------------------------------------------------

create table if not exists public.page_views_monthly (
  id bigint generated always as identity primary key,
  subject_type text not null check (subject_type in ('event', 'profile', 'portfolio_item')),
  subject_id uuid not null,
  view_month date not null,
  view_count bigint not null check (view_count > 0),
  unique (subject_type, subject_id, view_month)
);

create index if not exists page_views_monthly_subject_idx
  on public.page_views_monthly (subject_type, subject_id, view_month);

alter table public.page_views_monthly enable row level security;

create policy "monthly view totals are public"
  on public.page_views_monthly for select
  to anon, authenticated
  using (true);

grant select on public.page_views_monthly to anon, authenticated;

comment on table public.page_views_monthly is
  'Monthly view totals archived by the retention job. Contains no viewer_id or visitor_hash by design — individual browsing rows are unrecoverable after archival.';

-- ----------------------------------------------------------------
-- 2) Purge helper and single-transaction retention job
-- ----------------------------------------------------------------

create or replace function public.purge_page_views_before (p_cutoff timestamptz)
returns bigint
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.page_views
    where viewed_at < p_cutoff
    returning 1
  )
  select count(*)::bigint from deleted;
$$;

revoke execute on function public.purge_page_views_before (timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_page_views_before (timestamptz) to service_role;

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
  insert into public.page_views_monthly
    (subject_type, subject_id, view_month, view_count)
  select
    pv.subject_type,
    pv.subject_id,
    date_trunc('month', pv.viewed_at)::date,
    count(*)
  from public.page_views pv
  where pv.viewed_at < v_cutoff
  group by pv.subject_type, pv.subject_id, date_trunc('month', pv.viewed_at)
  on conflict (subject_type, subject_id, view_month) do update
    set view_count = public.page_views_monthly.view_count + excluded.view_count;

  get diagnostics v_archived = row_count;

  v_purged := public.purge_page_views_before(v_cutoff);

  return query select v_archived, v_purged;
end;
$$;

revoke execute on function public.run_page_view_retention (interval)
  from public, anon, authenticated;
grant execute on function public.run_page_view_retention (interval) to service_role;

-- ----------------------------------------------------------------
-- 3) Scheduled daily execution via pg_cron
-- ----------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'page-view-retention',
  '17 3 * * *',
  $$select public.run_page_view_retention();$$
);
