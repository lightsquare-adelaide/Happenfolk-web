-- 20261028200100: optional profile contact email and collaboration directory opt-in.
--
-- Privacy rule (matching personal build 0011):
--   * handle_new_user() never copies auth.users.email into profiles.contact_email,
--     so contact_email is NULL until the owner explicitly opts in by saving one.
--   * Row visibility stays governed by the profiles SELECT policy (published and
--     not hidden, or own row), and public directory views / search RPCs never
--     project contact_email.
--   * headline, location and website belong to package T (Ziang's migration) and
--     are intentionally not touched here.

alter table public.profiles
  add column if not exists contact_email text,
  add column if not exists open_to_collaborate boolean not null default false,
  add constraint profiles_contact_email_shape check (
    contact_email is null
    or (
      octet_length(contact_email) <= 320
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create index if not exists profiles_open_to_collaborate_idx
  on public.profiles (category_id, display_name)
  where open_to_collaborate and published;
