-- category_affinity gets its view signal back, without exposing raw views.
--
-- Audit finding A3 (26 October 2026). 0009 built category_affinity as a
-- security_invoker view over two branches: likes (3 points) and logged-in
-- page views (1 point). The likes branch works — interactions has an
-- "own rows" policy. The page_views branch could never return anything:
-- 0007 gives page_views RLS with ZERO policies precisely so that raw
-- visitor rows are unreadable by every client, and a security_invoker
-- view reads the table AS THE CALLER. So every member's view signal was
-- 0 and the "recommended" feeds silently degraded to plain trending.
--
-- The fix keeps both properties that made the original design safe:
--   * page_views stays deny-all. No policy is added, and no raw row,
--     subject id or timestamp leaves the table (tests/access/10 still
--     asserts a direct select returns zero rows for anon and members).
--   * category_affinity stays security_invoker, so nobody can read
--     somebody else's affinity profile through it.
-- The view branch now calls a SECURITY DEFINER aggregate that answers
-- exactly one question — "how many of MY OWN logged-in views fall in each
-- category" — with viewer_id pinned to auth.uid () inside the definer.
-- Aggregated per-category counts only; nothing else.

create function public.member_category_view_signal ()
returns table (category_id smallint, view_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.category_id,
    count(*)::integer as view_count
  from (
    select coalesce(e.category_id, p.category_id, op.category_id) as category_id
    from public.page_views pv
    left join public.events e
      on pv.subject_type = 'event' and e.id = pv.subject_id
    left join public.profiles p
      on pv.subject_type = 'profile' and p.id = pv.subject_id
    left join public.portfolio_items pi
      on pv.subject_type = 'portfolio_item' and pi.id = pv.subject_id
    left join public.profiles op
      on op.id = pi.profile_id
    -- The whole disclosure boundary of this function: the caller's own
    -- rows. auth.uid () is null for anon, and NULL never equals a
    -- viewer_id, so an anonymous caller gets zero rows.
    where pv.viewer_id = auth.uid ()
  ) s
  where s.category_id is not null
  group by s.category_id
$$;

revoke execute on function public.member_category_view_signal () from public;
-- anon is granted only so that an anonymous SELECT of the view below stays
-- an empty result instead of a permission error on stacks whose default
-- privileges expose public views to anon. It can never return a row.
grant execute on function public.member_category_view_signal () to anon, authenticated;

-- Same three columns, same types (uuid, smallint, bigint), so the
-- dependent views recommended_events / recommended_artists keep working
-- untouched and the check-invariants discovery gate stays 4/4.
create or replace view public.category_affinity
with (security_invoker = true) as
select
  signal.member_id,
  signal.category_id,
  sum(signal.score) as affinity
from (
  select
    i.member_id,
    coalesce(e.category_id, p.category_id, op.category_id) as category_id,
    3 as score
  from public.interactions i
  left join public.events e
    on i.subject_type = 'event' and e.id = i.subject_id
  left join public.profiles p
    on i.subject_type = 'profile' and p.id = i.subject_id
  left join public.portfolio_items pi
    on i.subject_type = 'portfolio_item' and pi.id = i.subject_id
  left join public.profiles op
    on op.id = pi.profile_id
  union all
  select
    auth.uid () as member_id,
    s.category_id,
    s.view_count as score
  from public.member_category_view_signal () s
) signal
where signal.category_id is not null
  and signal.member_id is not null
group by signal.member_id, signal.category_id;
