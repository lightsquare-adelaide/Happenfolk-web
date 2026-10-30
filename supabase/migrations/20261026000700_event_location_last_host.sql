-- E1 (Events S5): events.location + a concurrency-safe last-host guard.
--
-- events.location: one required free-text line (no maps, no geocoding).
-- Required-ness is enforced by the API/UI on every create and edit; the
-- column stays nullable so pre-existing rows on already-migrated stacks
-- remain readable instead of failing the ALTER.
--
-- GRANT. Migration 20261026000100 replaced the table-wide UPDATE grant
-- on public.events with an explicit column list that omits host_id.
-- That list is closed: without the grant below, a collaborator editing
-- the new column gets "permission denied for column location" even
-- though RLS allows the row.
--
-- THE LAST-HOST GUARD. 0007's delete policy on event_collaborators is
-- `using (is_event_host(...))`, which lets the host remove ANY roster
-- row, including their own. Remove the only host-role row and the
-- event becomes unmanageable. A row-level policy cannot express "at
-- least one row must survive", so this is a row-level trigger.
--
-- Two failure modes of the earlier single-stack implementation are
-- fixed here (leader review of Lightsquare migration 0012):
--
--   1. CONCURRENCY. Counting surviving hosts without a lock lets two
--      transactions each remove a different host row, each count the
--      other's not-yet-committed row as a survivor, and both commit —
--      zero hosts. The guard now locks the OLD parent event row
--      (SELECT ... FOR UPDATE) before counting, serialising every
--      roster mutation per event. tests/events/01 is a deterministic
--      two-transaction regression that observes a real waiter
--      (pg_blocking_pids) before committing the first transaction.
--
--   2. REASSIGNMENT. Firing only on UPDATE OF role let a host-role row
--      escape its event by changing event_id or profile_id while the
--      role stayed 'host' — the old event silently lost its last host.
--      The trigger now also fires on event_id and profile_id changes,
--      and the "still a host" fast path requires the row to keep the
--      same event AND profile, so a move is counted as a removal from
--      the old event. tests/events/02 pins both reassignment paths.
--
-- Event cascade deletion stays allowed: when the parent event row is
-- deleted, its roster rows arrive here via the FK cascade AFTER the
-- parent is gone, so the locking probe finds no event and lets the
-- cascade through (the guard protects LIVING events only; blocking the
-- cascade would make events undeletable — tests/access scenario 11).
--
-- SECURITY DEFINER + empty search_path matches the 0007 helpers: the
-- parent lock and the count run with owner rights so they cannot be
-- blinded by the very visibility rules they protect.

alter table public.events
  add column location text;

-- See the GRANT note above: 20261026000100 made the events UPDATE
-- grant a closed column list, so every new writable column needs its
-- own grant or collaborators cannot edit it despite correct RLS.
grant update (location) on public.events to authenticated;

create function public.prevent_last_host_removal () returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  other_hosts integer;
begin
  -- Only host-role rows are guarded; plain collaborators come and go.
  if old.role <> 'host' then
    return coalesce(new, old);
  end if;

  -- An UPDATE that keeps the same profile on the same event as a host
  -- (for example a no-op `set role = 'host'`) removes nobody.
  if tg_op = 'UPDATE'
     and new.role = 'host'
     and new.event_id = old.event_id
     and new.profile_id = old.profile_id then
    return new;
  end if;

  -- Lock the OLD parent event before counting. This serialises all
  -- roster mutations for one event: a second transaction removing
  -- another host waits here until the first commits, then counts the
  -- committed state. When the parent event is itself being deleted,
  -- the cascade fires after the parent row is gone and this probe
  -- finds nothing — that is the allowed cascade path.
  perform 1 from public.events where id = old.event_id for update;
  if not found then
    return coalesce(new, old);
  end if;

  select count(*) into other_hosts
    from public.event_collaborators
    where event_id = old.event_id
      and role = 'host'
      and profile_id <> old.profile_id;
  if other_hosts = 0 then
    raise exception 'LAST_HOST: an event must keep at least one host; the last host cannot be removed';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_prevent_last_host_removal
  before delete or update of role, event_id, profile_id
  on public.event_collaborators
  for each row
  execute function public.prevent_last_host_removal ();
