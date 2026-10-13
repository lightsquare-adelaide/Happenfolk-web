"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "../env";

/**
 * Browser-side Supabase client. Persists the session in cookies using
 * the exact @supabase/ssr format the middleware and server client read.
 *
 * Permission decisions MUST go through supabase.auth.getUser().
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
