-- The stack restricts event updates to explicitly writable columns.
-- Keep host_id protected while allowing the collaboration team to edit
-- the availability column added by the unchanged teammate migration.
grant update (open_to_collaborate) on public.events to authenticated;
