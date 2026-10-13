import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "../env";

/**
 * Server-side Supabase client for Server Components, Server Actions and
 * Route Handlers. Reads (and, where the context allows, writes) the
 * session cookies managed by @supabase/ssr.
 *
 * In Server Components cookie writes throw; the try/catch is the
 * official pattern — session refresh happens in middleware, which owns
 * a mutable response.
 *
 * Permission decisions MUST go through supabase.auth.getUser() (server
 * verified). Never decide authorization from the local session snapshot — it only
 * decodes the local cookie.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component: writes are forbidden; middleware refreshes.
        }
      },
    },
  });
}
