-- Preserve conflicting metadata and deduplicate atomically.
do $$
begin
  lock table public.media_assets in share row exclusive mode;

  if exists (
    select 1
    from public.media_assets a
    join public.media_assets b
      on a.portfolio_item_id = b.portfolio_item_id
      and a.path = b.path
      and a.bucket = b.bucket
      and a.variant = b.variant
      and a.id < b.id
    where (a.alt_text, a.content_type, a.width, a.height, a.position)
      is distinct from
      (b.alt_text, b.content_type, b.width, b.height, b.position)
  ) then
    raise exception 'Duplicate media assets have conflicting metadata'
      using hint = 'Review and reconcile duplicate rows before rerunning this migration.';
  end if;

  -- Metadata matches; retain the earliest row.
  delete from public.media_assets a using public.media_assets b
  where a.portfolio_item_id = b.portfolio_item_id
    and a.path = b.path
    and a.bucket = b.bucket
    and a.variant = b.variant
    and (a.created_at, a.id) > (b.created_at, b.id);

  create unique index if not exists media_assets_object_unique
    on public.media_assets (portfolio_item_id, path, bucket, variant);
end;
$$;
