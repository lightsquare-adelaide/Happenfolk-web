-- Bounded de-duplication for the public page-view recorder.
--
-- Audit finding A4 (26 October 2026). record_page_view is executable by
-- anon and had no de-duplication and no rate limit, so a loop of RPC
-- calls pushed any published subject to the top of the seven-day
-- trending views that both trending_* views order by.
--
-- What this migration does, and what it explicitly does NOT claim:
--   * One row per identity per subject per 30 minutes. A signed-in member
--     is identified by auth.uid (); an anonymous caller by a SHA-256 of
--     the proxy-supplied client IP and user agent, scoped to the subject
--     so the stored value cannot be used to correlate one visitor across
--     different subjects.
--   * The raw IP and user agent are never stored; page_views keeps its
--     zero-policy deny-all RLS, so no client can read the rows or the
--     hashes back.
--   * Check-and-insert is serialised with a transaction-scoped advisory
--     lock keyed on identity + subject. Without it two concurrent calls
--     from the same identity both pass the EXISTS check and both insert,
--     which is exactly the flood this is meant to bound.
--   * Residual risk, not mitigated here: rotating or spoofed client
--     identity (proxy chains, botnets, a browser that sends no user
--     agent) still produces distinct hashes, and a caller with many
--     identities can still add many rows. This is a local, dependency-free
--     bound on single-identity flooding, not complete anti-abuse. A real
--     deployment belongs to rate limiting at the edge plus server-side
--     view recording (Public Discovery vertical).

alter table public.page_views
  add column if not exists visitor_hash text;

comment on column public.page_views.visitor_hash is
  'Subject-scoped SHA-256 of proxy client IP + user agent for anonymous dedupe. NULL for signed-in viewers (viewer_id identifies them). Not reversible to the raw IP; never exposed to clients.';

-- Dedupe lookups are always (identity, subject, recent window).
create index if not exists page_views_viewer_dedupe_idx
  on public.page_views (viewer_id, subject_type, subject_id, viewed_at)
  where viewer_id is not null;
create index if not exists page_views_visitor_dedupe_idx
  on public.page_views (visitor_hash, subject_type, subject_id, viewed_at)
  where visitor_hash is not null;

-- 30 minutes: long enough that a refresh loop or a re-render cannot farm
-- the trending counter, short enough that a genuine second visit the same
-- day still counts.
create function public.page_view_dedupe_window ()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '30 minutes'
$$;

-- NULL when no usable proxy identity is present (direct SQL, a test
-- harness, a proxy that strips both headers). Callers then insert without
-- deduping rather than sharing one global fingerprint, which would let an
-- unrelated visitor suppress somebody else's view.
create function public.page_view_visitor_hash (
  p_subject_type text,
  p_subject_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when headers.ip is null and headers.user_agent is null then null
    else left(
      encode(
        sha256(
          convert_to(
            coalesce(headers.ip, '') || '|' ||
            coalesce(headers.user_agent, '') || '|' ||
            p_subject_type || '|' ||
            p_subject_id::text,
            'UTF8'
          )
        ),
        'hex'
      ),
      32
    )
  end
  from (
    select
      nullif(h ->> 'x-forwarded-for', '') as ip,
      nullif(h ->> 'user-agent', '') as user_agent
    from (
      select coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      ) as h
    ) request_headers
  ) headers
$$;

-- Both helpers are only useful inside record_page_view, which is SECURITY
-- DEFINER and therefore does not need the caller to hold EXECUTE. Supabase
-- default privileges grant EXECUTE on every new public function to anon and
-- authenticated (0011 hit the same trap with the payment stub switch), so
-- each role is revoked explicitly: no client probe can enumerate hashes,
-- replay them, or read the window from outside the recorder.
revoke execute on function public.page_view_dedupe_window () from public, anon, authenticated;
revoke execute on function public.page_view_visitor_hash (text, uuid) from public, anon, authenticated;

create or replace function public.record_page_view (
  p_subject_type text,
  p_subject_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  v_viewer uuid := auth.uid ();
  v_visitor_hash text;
  v_window interval := public.page_view_dedupe_window ();
begin
  if p_subject_type not in ('event', 'profile', 'portfolio_item') then
    raise exception 'UNKNOWN_SUBJECT_TYPE: %', p_subject_type;
  end if;

  v_ok :=
    case p_subject_type
      when 'event' then
        exists (select 1 from public.events e
                where e.id = p_subject_id and e.status = 'published')
      when 'profile' then
        exists (select 1 from public.profiles p
                where p.id = p_subject_id and p.published)
      when 'portfolio_item' then
        exists (select 1 from public.portfolio_items pi
                where pi.id = p_subject_id and pi.published)
    end;

  if not v_ok then
    raise exception 'SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED';
  end if;

  if v_viewer is null then
    v_visitor_hash := public.page_view_visitor_hash (p_subject_type, p_subject_id);
  end if;

  -- No identity at all (no session, no proxy headers): nothing to dedupe
  -- on, and inventing a shared key would let unrelated callers collide.
  if v_viewer is not null or v_visitor_hash is not null then
    perform pg_advisory_xact_lock (
      hashtextextended (
        coalesce(v_viewer::text, v_visitor_hash) || '|' ||
        p_subject_type || '|' || p_subject_id::text,
        0
      )
    );

    if exists (
      select 1 from public.page_views pv
      where pv.subject_type = p_subject_type
        and pv.subject_id = p_subject_id
        and pv.viewed_at > now () - v_window
        and (
          (v_viewer is not null and pv.viewer_id = v_viewer)
          or (v_viewer is null and pv.visitor_hash = v_visitor_hash)
        )
    ) then
      return;  -- already counted inside the window
    end if;
  end if;

  insert into public.page_views (subject_type, subject_id, viewer_id, visitor_hash)
  values (p_subject_type, p_subject_id, v_viewer, v_visitor_hash);
end;
$$;

-- record_member_view (0009) delegates here, so the same bound applies to
-- logged-in views and therefore to the category_affinity view signal:
-- refreshing one artist's page in a loop no longer inflates affinity.
-- The grant list from 0006 is unchanged; re-stating it keeps this
-- migration self-contained after CREATE OR REPLACE.
grant execute on function public.record_page_view (text, uuid) to anon, authenticated;
