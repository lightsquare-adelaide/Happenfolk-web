-- Public event pages show the collaborators of published events.
-- Draft rosters remain visible only to the event team.
DROP POLICY IF EXISTS "event team sees collaborators"
  ON public.event_collaborators;

CREATE POLICY "event team and public visitors see collaborators"
  ON public.event_collaborators FOR SELECT
  TO anon, authenticated
  USING (
    public.is_event_collaborator(event_id, auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_id
        AND e.status = 'published'
    )
  );