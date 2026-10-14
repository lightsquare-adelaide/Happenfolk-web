-- Only published events may appear in the public trending view.
-- Preserve the existing columns and seven-day view counts.

CREATE OR REPLACE VIEW public.trending_events AS
SELECT
  e.id,
  e.host_id,
  e.category_id,
  e.title,
  e.starts_at,
  e.price_cents,
  COUNT(pv.id) FILTER (
    WHERE pv.viewed_at > now() - interval '7 days'
  ) AS view_count
FROM public.events AS e
LEFT JOIN public.page_views AS pv
  ON pv.subject_type = 'event'
  AND pv.subject_id = e.id
WHERE e.status = 'published'
GROUP BY e.id;