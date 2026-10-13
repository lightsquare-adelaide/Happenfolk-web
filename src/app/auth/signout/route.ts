import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Logout as a plain HTML-form-friendly route handler: the header's
 * user menu posts here, the session is revoked server-side and the
 * session cookies are cleared on the response.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
