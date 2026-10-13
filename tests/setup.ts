import dotenv from "dotenv";

// Load local Supabase credentials when present so tests that touch the
// local stack get real values without hardcoding them. Fall back to
// dummy placeholders so pure unit tests (e.g. env validation) stay
// hermetic and never depend on local files.
dotenv.config({ path: ".env.local" });

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";
