import { isUuid, registrationErrorMessage } from "@/lib/registration";
import { isSameOriginRequest } from "@/lib/request-origin";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to cancel a registration" }, { status: 401 });
  }

  const { error } = await supabase.rpc("cancel_registration", {
    p_registration_id: id,
  });
  if (error) {
    const message = error.message;
    if (message.includes("REGISTRATION_NOT_FOUND_OR_NOT_YOURS")) {
      return NextResponse.json({ error: registrationErrorMessage(message) }, { status: 404 });
    }
    return NextResponse.json({ error: "Cancellation failed; please try again later" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
