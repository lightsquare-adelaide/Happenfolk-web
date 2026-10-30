-- 20261026000800: portfolio item metadata (year, tags) and deterministic
-- per-owner ordering (position).
--
-- Scope notes (P1, lead-frozen design):
--   * year is nullable and range-checked; tags is a bounded, normalized
--     text[] — the trigger below is the trust boundary mirror of
--     src/lib/portfolio-management.ts::normalizeTags.
--   * EVERY insert appends: the BEFORE INSERT trigger always allocates
--     position = max + 1 under a lock on the owner's profile row, even
--     when the writer supplied a position. This keeps the existing #20
--     pipeline (src/lib/media/store.ts::createDraftItem inserts directly
--     into portfolio_items with no position) compatible and stops any
--     direct write from sneaking into the middle of the list.
--   * move_portfolio_item(p_item_id, p_direction) is the only ordering
--     mutation callers can invoke. It is SECURITY DEFINER with an
--     auth.uid() ownership check, no caller-supplied owner parameter,
--     and it locks the caller's profile row first. Under that lock it
--     normalizes the caller's COMPLETE deterministic order
--     (position, created_at, id) to unique dense positions before the
--     neighbor swap, so >=3 tied legacy rows still move correctly and
--     every unmoved row keeps its relative order.
--   * The table-wide UPDATE grant from 20261013000100 let a caller edit
--     position directly, outside any lock. It is replaced with minimal
--     column grants excluding position/id/profile_id; ordering changes
--     must go through the RPC. All existing authenticated update paths
--     (title, description, media_kind, published, published_at) and the
--     new year/tags columns stay granted.

-- ---------------- metadata columns ----------------

-- position carries a default only so generated Insert types keep it
-- optional for direct inserts (the #20 createDraftItem path supplies no
-- position); the BEFORE INSERT trigger below ALWAYS overwrites it.
alter table public.portfolio_items
  add column year smallint,
  add column tags text[] not null default '{}',
  add column position integer not null default 0;

alter table public.portfolio_items
  add constraint portfolio_items_year_range check (year between 1850 and 2100),
  add constraint portfolio_items_tags_bounded check (cardinality (tags) <= 12);

-- Tags normalization at the trust boundary: lowercase, trimmed, 1-30
-- chars each, deduplicated, at most 12 kept, NULL becomes '{}'. The
-- pure mirror lives in src/lib/portfolio-management.ts so forms get the
-- same result without a round trip.
create function public.portfolio_items_normalize_tags ()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kept text[] := '{}';
  tag text;
begin
  foreach tag in array coalesce (new.tags, '{}') loop
    tag := lower (btrim (tag));
    if char_length (tag) between 1 and 30 and not (tag = any (kept)) then
      kept := array_append (kept, tag);
    end if;
  end loop;
  new.tags := kept[1:12];
  return new;
end;
$$;

create trigger trg_portfolio_items_normalize_tags
  before insert or update of tags on public.portfolio_items
  for each row execute function public.portfolio_items_normalize_tags ();

-- ---------------- backfill existing rows ----------------

-- Legacy rows get deterministic per-owner positions in the same order
-- the read path uses: (created_at, id). The updated_at touch trigger is
-- disabled around the backfill so a schema migration does not pretend
-- every work was just edited.
alter table public.portfolio_items disable trigger trg_portfolio_items_touch_updated_at;
update public.portfolio_items pi
set position = s.rn
from (
  select id,
    (row_number () over (partition by profile_id order by created_at, id) - 1)::integer as rn
  from public.portfolio_items
) s
where pi.id = s.id;
alter table public.portfolio_items enable trigger trg_portfolio_items_touch_updated_at;

create index portfolio_items_owner_order_idx
  on public.portfolio_items (profile_id, position, created_at, id);

-- ---------------- append allocation on every insert ----------------

create function public.portfolio_items_allocate_position ()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_position integer;
begin
  -- Always append. A supplied position is intentionally overwritten:
  -- ordering is owned by this trigger and move_portfolio_item, never by
  -- a direct write. The profile-row lock serializes concurrent appends
  -- for one owner, making the max+1 allocation atomic; a second insert
  -- queues here until the first commits, so two appends can never read
  -- the same max.
  perform 1 from public.profiles p where p.id = new.profile_id for update;
  if not found then
    raise exception 'portfolio owner profile missing' using errcode = '42501';
  end if;
  select coalesce (max (pi.position), -1) + 1 into next_position
  from public.portfolio_items pi
  where pi.profile_id = new.profile_id;
  new.position := next_position;
  return new;
end;
$$;

create trigger trg_portfolio_items_allocate_position
  before insert on public.portfolio_items
  for each row execute function public.portfolio_items_allocate_position ();

-- ---------------- caller-scoped move RPC ----------------

create function public.move_portfolio_item (p_item_id uuid, p_direction text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid ();
  v_current record;
  v_neighbor record;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'invalid direction: expected up or down';
  end if;

  -- One lock per owner serializes every ordering mutation (moves and
  -- append allocations) for that artist. There is no owner parameter:
  -- the caller can only ever move inside their own list.
  perform 1 from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  -- Normalize the caller's COMPLETE deterministic order to unique dense
  -- positions before choosing a neighbor. Direct legacy writes could
  -- have produced ties; repairing only the moved pair is wrong with
  -- three or more tied rows, while whole-list normalization keeps every
  -- unmoved row's relative order under (position, created_at, id).
  with ordered as (
    select pi.id,
      (row_number () over (order by pi.position, pi.created_at, pi.id) - 1)::integer as rn
    from public.portfolio_items pi
    where pi.profile_id = v_uid
  )
  update public.portfolio_items pi
  set position = ordered.rn
  from ordered
  where pi.id = ordered.id and pi.position <> ordered.rn;

  select pi.id, pi.position into v_current
  from public.portfolio_items pi
  where pi.id = p_item_id and pi.profile_id = v_uid;
  if not found then
    raise exception 'work not owned' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select pi.id, pi.position into v_neighbor
    from public.portfolio_items pi
    where pi.profile_id = v_uid and pi.position < v_current.position
    order by pi.position desc
    limit 1;
  else
    select pi.id, pi.position into v_neighbor
    from public.portfolio_items pi
    where pi.profile_id = v_uid and pi.position > v_current.position
    order by pi.position
    limit 1;
  end if;
  if not found then
    return false;
  end if;

  update public.portfolio_items pi
  set position = case pi.id
      when v_current.id then v_neighbor.position
      else v_current.position
    end
  where pi.profile_id = v_uid and pi.id in (v_current.id, v_neighbor.id);
  return true;
end;
$$;

-- ---------------- privileges ----------------

-- Position is only writable through the allocation trigger and the RPC.
revoke update on public.portfolio_items from authenticated;
grant update (title, description, media_kind, published, published_at, year, tags)
  on public.portfolio_items to authenticated;

-- Postgres grants EXECUTE to PUBLIC by default; the RPC checks
-- auth.uid() but must not be reachable from anon at all.
revoke execute on function public.move_portfolio_item (uuid, text) from public, anon;
grant execute on function public.move_portfolio_item (uuid, text) to authenticated;
revoke execute on function public.portfolio_items_allocate_position () from public;
revoke execute on function public.portfolio_items_normalize_tags () from public;
