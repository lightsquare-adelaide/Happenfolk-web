-- events.host_id is immutable for every client role.
--
-- Audit finding A1 (26 October 2026). The 0007 policy
-- "collaborators update events" decides WHO may update a row (host or
-- listed collaborator) but a row-level policy cannot say WHICH columns
-- that update may touch. Any collaborator could therefore run
--
--   update public.events set host_id = auth.uid () where id = <event>;
--
-- WITH CHECK passed, because they were a collaborator of the row they
-- had just read, and the update handed them the host-only powers:
-- deleting the event ("hosts delete own events") and rewriting the
-- collaborator roster ("hosts add/remove collaborators").
-- tests/access/11 covered direct deletes but not this bypass;
-- tests/access/23 now pins both layers below.
--
-- Two independent layers, because either one alone can be undone by a
-- later migration that re-grants privileges or re-creates a policy:
--   1. a BEFORE UPDATE trigger that rejects any host_id change;
--   2. column-level UPDATE privileges that omit host_id, so the column
--      is not writable through the API at all.
--
-- Ownership transfer is deliberately not provided: no product surface
-- needs it yet, and an event always keeps the organiser it was created
-- with. A future host-transfer RPC must be SECURITY DEFINER, host-only,
-- and shipped together with a migration that opens a controlled
-- exception to this trigger (service_role is unaffected by the grant
-- change but is still stopped by the trigger, by design).

create function public.events_host_id_immutable ()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.host_id is distinct from old.host_id then
    raise exception 'EVENT_HOST_IMMUTABLE: an event keeps the organiser it was created with'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Fires only when host_id appears in the SET list, so ordinary
-- collaborator edits (title, description, times, cover) pay nothing.
create trigger trg_events_host_id_immutable
  before update of host_id on public.events
  for each row execute function public.events_host_id_immutable ();

-- Layer 2. A table-level UPDATE grant subsumes every column, so the
-- table-wide privilege granted by 20261013000100 (and by the default
-- privileges on older stacks) is replaced by an explicit column list
-- that leaves host_id out. Columns that no client has any business
-- writing (id, created_at) stay out of the list too; search_vector and
-- updated_at are trigger-maintained and never sent by a client, but
-- they are listed so a future owner-side update is not blocked by
-- privilege rather than by policy.
--
-- Consequence for later migrations: because the grant below is a closed
-- column list, ANY new writable events column (the Events vertical's
-- location column, for example) must be added to a fresh
-- `grant update (<column>) on public.events to authenticated` in the
-- migration that creates it, or clients get "permission denied for
-- column" instead of a policy decision.
revoke update on public.events from authenticated;
revoke update on public.events from anon;

grant update (
  category_id,
  title,
  description,
  status,
  starts_at,
  ends_at,
  price_cents,
  capacity,
  cover_path,
  search_vector,
  updated_at
) on public.events to authenticated;
