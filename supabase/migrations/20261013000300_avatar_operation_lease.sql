create table public.avatar_operation_locks (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.avatar_operation_locks enable row level security;
revoke all on public.avatar_operation_locks from public, anon, authenticated;

create function public.claim_avatar_operation(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.avatar_operation_locks(profile_id, token, expires_at)
  values (auth.uid(), p_token, now() + interval '5 minutes')
  on conflict (profile_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where avatar_operation_locks.expires_at < now();
  get diagnostics changed = row_count;
  return changed = 1;
end; $$;

create function public.release_avatar_operation(p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.avatar_operation_locks where profile_id = auth.uid() and token = p_token;
$$;
revoke execute on function public.claim_avatar_operation(uuid), public.release_avatar_operation(uuid) from public, anon;
grant execute on function public.claim_avatar_operation(uuid), public.release_avatar_operation(uuid) to authenticated;
