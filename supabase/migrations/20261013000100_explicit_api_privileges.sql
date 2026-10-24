-- Fresh Supabase projects may disable automatic grants. RLS policies alone
-- do not confer table privileges. Grant only the operations those policies use.
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.profiles, public.portfolio_items,
  public.media_assets, public.events, public.event_collaborators,
  public.trending_events, public.trending_artists, public.like_counts
  to anon, authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.portfolio_items, public.media_assets,
  public.events to authenticated;
grant insert, delete on public.event_collaborators to authenticated;
grant select, insert, delete on public.interactions to authenticated;
grant select on public.category_affinity, public.recommended_events,
  public.recommended_artists, public.event_registrations, public.orders
  to authenticated;

-- Existing tests expect denied row access (empty rows), not a table-grant
-- error. Zero policies keep raw visitor records unreadable and unwritable.
grant select on public.page_views to anon, authenticated;

-- Intentionally no direct client writes to orders/registrations/page_views,
-- no sequence grants, no changes to RLS, and no grants for future tables.
