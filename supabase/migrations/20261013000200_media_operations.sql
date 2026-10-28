-- Uniqueness makes storage upserts and asset rows share the same retry key.
-- Preserve one existing row if an earlier upload implementation duplicated it.
delete from public.media_assets a using public.media_assets b
where a.portfolio_item_id = b.portfolio_item_id and a.path = b.path
  and a.bucket = b.bucket and a.variant = b.variant and a.id > b.id;
create unique index media_assets_object_unique
  on public.media_assets (portfolio_item_id, path, bucket, variant);

-- A short lease serializes storage transitions across application processes.
-- Clients cannot read or write lease rows directly, including on older stacks
-- whose default privileges automatically expose newly created tables.
create table public.media_operation_locks (
  item_id uuid primary key references public.portfolio_items(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.media_operation_locks enable row level security;
revoke all on public.media_operation_locks from public, anon, authenticated;

create function public.claim_media_operation(p_item_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.portfolio_items where id = p_item_id and profile_id = auth.uid()
  ) then raise exception 'work not owned' using errcode = '42501'; end if;
  insert into public.media_operation_locks(item_id, token, expires_at)
  values (p_item_id, p_token, now() + interval '5 minutes')
  on conflict (item_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where media_operation_locks.expires_at < now();
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

create function public.release_media_operation(p_item_id uuid, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.media_operation_locks l
  using public.portfolio_items i
  where l.item_id = p_item_id and l.token = p_token
    and i.id = l.item_id and i.profile_id = auth.uid();
$$;

-- The row lock makes both positions change in one database transaction.
create function public.reorder_media(p_item_id uuid, p_asset_id uuid, p_direction text)
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
  update public.media_assets set position = case
    when path = current_row.path or path like left(current_row.path, length(current_row.path) - length(split_part(current_row.path, '.', -1)) - 1) || '-%' then neighbor.position
    else current_row.position end
  where portfolio_item_id = p_item_id and (
    path = current_row.path or path = neighbor.path or
    path like left(current_row.path, length(current_row.path) - length(split_part(current_row.path, '.', -1)) - 1) || '-%' or
    path like left(neighbor.path, length(neighbor.path) - length(split_part(neighbor.path, '.', -1)) - 1) || '-%'
  );
  return true;
end; $$;

revoke execute on function public.claim_media_operation(uuid, uuid),
  public.release_media_operation(uuid, uuid), public.reorder_media(uuid, uuid, text)
  from public, anon;
grant execute on function public.claim_media_operation(uuid, uuid),
  public.release_media_operation(uuid, uuid), public.reorder_media(uuid, uuid, text)
  to authenticated;
