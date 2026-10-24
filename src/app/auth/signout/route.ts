import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Logout as a plain HTML-form-friendly route handler: the header's
 * user menu posts here, the session is revoked server-side and the
 * session cookies are cleared on the response.
 *
 * Clear-Site-Data drops the browser's HTTP cache, web storage and any
 * service worker with its caches, so no member data survives logout
 * or an account switch (FR-ACC-10). Cookies are left to signOut so
 * unrelated ones survive.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.headers.set("Clear-Site-Data", '"cache", "storage"');
  return response;
}
