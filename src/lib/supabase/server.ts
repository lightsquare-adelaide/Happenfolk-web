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
/**
 * Scoped PostgREST header forwarding for the view-recording route ONLY.
 *
 * F's anonymous dedupe (migration 20261026000600) derives the visitor
 * identity inside record_page_view from the headers PostgREST received
 * (request.headers: x-forwarded-for + user-agent). A server-to-DB call
 * made with the plain SDK client arrives with supabase-js's own headers,
 * so every anonymous visitor behind this Next server would collapse into
 * ONE fingerprint (subject-global suppression). Passing the validated
 * trusted client IP and the original User-Agent as global headers on a
 * dedicated client preserves per-visitor identity without touching any
 * ordinary auth caller.
 *
 * This is a deliberate, narrow trust decision: the values MUST come from
 * the trusted-proxy extraction in src/lib/view-throttle.ts, never from
 * arbitrary client headers. It is not spoof-proof against callers who
 * talk to PostgREST directly with the public anon key (documented
 * residual risk, same as the migration's own note).
 */
export type ViewRecordingIdentity = {
  /** Validated client IP from the trusted proxy header (never logged). */
  clientIp: string;
  /** Original validated User-Agent of the visitor (never logged). */
  userAgent: string;
};

export async function createSupabaseServerClient(options?: {
  viewRecordingIdentity?: ViewRecordingIdentity;
}) {
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
    ...(options?.viewRecordingIdentity
      ? {
          global: {
            headers: {
              "x-forwarded-for": options.viewRecordingIdentity.clientIp,
              "user-agent": options.viewRecordingIdentity.userAgent,
            },
          },
        }
      : {}),
  });
}
