import { z } from "zod";

/**
 * Typed environment. Parsed at module load so a missing variable fails
 * the build (or test run) immediately instead of surfacing as a runtime
 * mystery inside a Supabase call.
 *
 * Only NEXT_PUBLIC_* (browser-safe) values live here. The service-role key
 * must NEVER be added to this module, to a NEXT_PUBLIC_* variable, or to
 * any client component — the repo is public.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string("NEXT_PUBLIC_SUPABASE_URL is required")
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .refine((v) => v.startsWith("http://") || v.startsWith("https://"), {
      message: "NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL",
    }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string("NEXT_PUBLIC_SUPABASE_ANON_KEY is required")
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_SITE_URL: z
    .string("NEXT_PUBLIC_SITE_URL is required")
    .min(1, "NEXT_PUBLIC_SITE_URL is required"),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Pure parse used by tests; throws on missing/invalid vars. */
export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** Build-time validated environment for app code. */
// Next.js inlines public variables only when accessed by their explicit names.
// Passing process.env itself leaves the browser reading an empty runtime object.
export const env: AppEnv = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
});
