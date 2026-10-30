-- Repair ordering for existing databases.
create or replace function public.reorder_media(p_item_id uuid, p_asset_id uuid, p_direction text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_row public.media_assets; neighbor public.media_assets;
begin
  perform 1 from public.portfolio_items
  where id = p_item_id and profile_id = auth.uid() for update;
  if not found then raise exception 'work not owned' using errcode = '42501'; end if;
  if p_direction not in ('up', 'down') then raise exception 'invalid direction'; end if;
  select * into current_row from public.media_assets
  where id = p_asset_id and portfolio_item_id = p_item_id
    and bucket = 'drafts' and variant = 'original';
  if not found then raise exception 'media not found'; end if;
  if p_direction = 'up' then
    select * into neighbor from public.media_assets
    where portfolio_item_id = p_item_id and bucket = 'drafts' and variant = 'original'
      and (position, created_at, id) < (current_row.position, current_row.created_at, current_row.id)
    order by position desc, created_at desc, id desc limit 1;
  else
    select * into neighbor from public.media_assets
    where portfolio_item_id = p_item_id and bucket = 'drafts' and variant = 'original'
      and (position, created_at, id) > (current_row.position, current_row.created_at, current_row.id)
    order by position, created_at, id limit 1;
  end if;
  if not found then return false; end if;
    -- Assign distinct positions, then swap the selected adjacent assets.
  -- Update every original and its public variants together.
  with ranked as (
    select
      id,
      path,
      (row_number() over (
        order by position, created_at, id
      ) - 1)::integer as slot
    from public.media_assets
    where portfolio_item_id = p_item_id
      and bucket = 'drafts'
      and variant = 'original'
  ),
  moves as (
    select
      r.id,
      r.path,
      case
        when r.id = current_row.id then
          (select slot from ranked where id = neighbor.id)
        when r.id = neighbor.id then
          (select slot from ranked where id = current_row.id)
        else r.slot
      end as next_position
    from ranked r
  )
  update public.media_assets as asset
  set position = moves.next_position
  from moves
  where asset.portfolio_item_id = p_item_id
    and (
      (
        asset.bucket = 'drafts'
        and asset.variant = 'original'
        and asset.id = moves.id
      )
      or (
        asset.bucket = 'media'
        and asset.variant in ('small', 'medium', 'display')
        and asset.path =
          regexp_replace(moves.path, '\.[^./]+$', '')
          || '-' || asset.variant
          || case
            when asset.variant = 'display' then '.mp4'
            else '.webp'
          end
      )
    );
  return true;
end; $$;
