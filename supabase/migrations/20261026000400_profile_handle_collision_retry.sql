-- Registration must not fail on a concurrent handle collision.
--
-- Audit finding A7 (26 October 2026). 0003's handle_new_user derived a
-- free handle with "look for a free suffix, then insert". Two sign-ups
-- racing for the same base handle both saw the same free candidate; the
-- loser hit profiles_handle_key and the unique_violation propagated out
-- of the auth.users insert trigger, so the sign-up request failed with a
-- raw 500 instead of getting a suffixed handle.
--
-- The unique index stays the only authority. The existence pre-check is
-- kept because it produces the deterministic, human-readable suffix
-- (handle, handle1, handle2 ...) for the ordinary serial case; the
-- exception block adds the retry that the race needs. Only a collision
-- ON THE HANDLE is retried — a duplicate primary key or any other
-- constraint violation is re-raised unchanged, so a real bug still
-- surfaces instead of looping.

create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix int := 0;
  v_constraint text;
begin
  base := lower(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'handle', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'member'
    )
  );
  base := regexp_replace(base, '[^a-z0-9_]+', '_', 'g');
  base := regexp_replace(base, '^_+|_+$', '');
  if length(base) < 3 then
    base := 'member_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base := substr(base, 1, 30);

  candidate := base;
  loop
    -- Serial case: walk to the next free suffix before trying to write.
    while exists (select 1 from public.profiles p where p.handle = candidate) loop
      suffix := suffix + 1;
      candidate := substr(base, 1, 30 - length(suffix::text)) || suffix::text;
    end loop;

    begin
      insert into public.profiles (id, handle, display_name, account_kind, category_id)
      values (
        new.id,
        candidate,
        coalesce(
          nullif(new.raw_user_meta_data ->> 'display_name', ''),
          initcap(replace(candidate, '_', ' '))
        ),
        case new.raw_user_meta_data ->> 'account_kind'
          when 'organisation' then 'organisation'::public.account_kind
          else 'individual'::public.account_kind
        end,
        case
          when new.raw_user_meta_data ->> 'category_id' ~ '^\d+$'
            then (new.raw_user_meta_data ->> 'category_id')::smallint
          else null
        end
      );
      exit;  -- inserted: leave the loop
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'profiles_handle_key' then
          raise;
        end if;
        suffix := suffix + 1;
        if suffix > 1000 then
          raise exception 'HANDLE_EXHAUSTED: could not derive a free handle for this account';
        end if;
        candidate := substr(base, 1, 30 - length(suffix::text)) || suffix::text;
    end;
  end loop;

  return new;
end;
$$;
