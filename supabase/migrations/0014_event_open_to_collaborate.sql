-- FR-COL-01: collaboration availability belongs to the event.
ALTER TABLE public.events
ADD COLUMN open_to_collaborate boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.open_to_collaborate IS
'Indicates that the event is seeking collaborators. Discovery requires published status.';