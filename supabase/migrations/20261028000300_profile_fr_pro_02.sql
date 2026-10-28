-- FR-PRO-02: optional public profile metadata.
ALTER TABLE public.profiles
  ADD COLUMN headline text,
  ADD COLUMN location text,
  ADD COLUMN website text,
  ADD CONSTRAINT profiles_website_http_url CHECK (
    website IS NULL
    OR website ~* '^https?://[^[:space:]/?#]+([/?#][^[:space:]]*)?$'
  );