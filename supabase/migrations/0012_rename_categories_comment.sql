-- 0012: carry the ArtLink -> Lightsquare rename into database metadata.
--
-- 0002 sets a comment on public.categories naming the old product. That
-- comment is live metadata: it is what `\d+ categories` and any schema
-- browser shows. 0002 itself is already applied on main, on CI and on
-- teammates' local stacks, so it is corrected forward here rather than
-- edited in place.
--
-- Wording is otherwise unchanged from 0002, including the Food category,
-- which replaced "Cook" per the client's clarification on 7 September.
comment on table public.categories is
  'The seven fixed Lightsquare categories (Music, Photography, Visual Arts, Performance, Design, Film, Food).';
