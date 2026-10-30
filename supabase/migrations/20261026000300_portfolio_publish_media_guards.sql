-- Closing the holes in the "no empty publication" guard.
--
-- Audit finding A6 (26 October 2026). 0004 guards alt_text on the two
-- doors it could see: flipping an item to published, and touching media
-- on an already-published item. These paths walked straight through:
--
--   (a) INSERT ... published = true. A brand-new published item has no
--       media rows yet, so the "every media row needs alt_text" check
--       quantified over an empty set and passed. The public artist page
--       then showed an empty card, and nothing ever re-checked the item:
--       the alt_text trigger only fires on media insert/update.
--   (b) DELETE from media_assets. The alt_text guard is
--       BEFORE INSERT OR UPDATE, so the owner of a published item could
--       delete its media rows and leave a published work with nothing in
--       it — the same end state as (a), reached from the other side.
--   (c) UPDATE media_assets.portfolio_item_id. Moving the last row of a
--       published work onto another of the owner's items empties the
--       published work exactly like (b) and fires no DELETE trigger.
--   (d) Two concurrent deletes of the last two rows. Each counts the
--       other as "still there" and both pass, so the published work ends
--       up empty anyway. The parent row is therefore locked before the
--       remaining-media count, which serialises the check per work.
--
-- Deleting a WHOLE work must stay possible, so the guard lets rows go
-- when their parent item is already gone: ON DELETE CASCADE removes the
-- portfolio_items row first, and the media trigger then finds no parent
-- to protect.

-- ---------------- (a) publishing requires media ----------------

create or replace function public.portfolio_items_publish_guard ()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published then
    if not exists (
      select 1 from public.media_assets m
      where m.portfolio_item_id = new.id
    ) then
      raise exception 'cannot publish portfolio item: no media attached';
    end if;
    if exists (
      select 1 from public.media_assets m
      where m.portfolio_item_id = new.id
        and (m.alt_text is null or btrim(m.alt_text) = '')
    ) then
      raise exception 'cannot publish portfolio item: media alt_text missing';
    end if;
    if old.published is distinct from true then
      new.published_at := coalesce(old.published_at, now ());
    end if;
  end if;
  return new;
end;
$$;

-- 0004's trigger already covers "before insert or update of published",
-- which is exactly the pair of doors (a) needs; only the function body
-- changed.

-- ------- (b)(c)(d) a published work keeps at least one media row -------

create function public.media_assets_last_media_guard ()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent uuid := old.portfolio_item_id;
  v_published boolean;
  v_remaining int;
begin
  -- An UPDATE that stays on the same parent cannot empty it; the
  -- alt_text guard from 0004 owns that case.
  if tg_op = 'UPDATE' and new.portfolio_item_id = v_parent then
    return new;
  end if;

  -- (d) Lock the parent work before deciding anything about it. Two
  -- concurrent deletions of the last two rows now queue here: the second
  -- one re-reads after the first commits and sees the true remaining
  -- count instead of a row that is already on its way out. Under the
  -- cascade path the parent is already deleted, so this finds nothing.
  select pi.published into v_published
  from public.portfolio_items pi
  where pi.id = v_parent
  for update;

  if not found then
    -- The whole work is being deleted and its media rows go with it.
    -- That path must never be blocked.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if not v_published then
    -- Drafts may be emptied freely; the publish guard above is what
    -- stops them going public without media.
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*) into v_remaining
  from public.media_assets m
  where m.portfolio_item_id = v_parent
    and m.id <> old.id;

  if v_remaining = 0 then
    raise exception 'cannot leave a published portfolio item without media: unpublish it first';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_media_assets_last_media_delete
  before delete on public.media_assets
  for each row execute function public.media_assets_last_media_guard ();

create trigger trg_media_assets_last_media_move
  before update of portfolio_item_id on public.media_assets
  for each row execute function public.media_assets_last_media_guard ();

-- The unpublish pipeline (src/lib/media/store.ts) deletes the public
-- derivative rows while the item is still published and flips the flag
-- afterwards. That stays legal: the private drafts originals are still
-- attached, so the work is never left with zero media. Only the last row
-- of a published work — deleted or moved away — is refused.
