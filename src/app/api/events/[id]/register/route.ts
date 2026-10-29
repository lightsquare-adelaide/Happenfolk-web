import { isUuid, registrationErrorMessage } from "@/lib/registration";
import { isSameOriginRequest } from "@/lib/request-origin";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ error: "Sign in to register" }, { status: 401 });
  }

  const { data: registrationId, error } = await supabase.rpc("register_for_event", {
    p_event_id: id,
  });
  if (error || typeof registrationId !== "string") {
    const message = error?.message ?? "register_for_event returned nothing";
    if (message.includes("AUTH_REQUIRED")) {
      return NextResponse.json({ error: "Sign in to register" }, { status: 401 });
    }
    if (message.includes("EVENT_FULL")) {
      return NextResponse.json({ error: registrationErrorMessage(message) }, { status: 409 });
    }
    if (message.includes("EVENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Event not found or not published" }, { status: 404 });
    }
    return NextResponse.json({ error: "Registration failed; please try again later" }, { status: 500 });
  }

  // Read back through RLS (own rows): confirmed => done, pending =>
  // route to the stub gateway with the newest pending order.
  const { data: registration, error: readError } = await supabase
    .from("event_registrations")
    .select("id, status")
    .eq("id", registrationId)
    .maybeSingle();

  if (readError || !registration) {
    return NextResponse.json({ error: "Could not load your registration. Please retry." }, { status: 500 });
  }
  let orderId: string | undefined;
  if (registration.status === "pending" || registration.status === "payment_failed") {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("registration_id", registrationId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError || !order) {
      return NextResponse.json({ error: "Could not load your order. Please retry." }, { status: 500 });
    }
    orderId = order.id;
  }

  return NextResponse.json({
    ok: true,
    registrationId,
    status: registration?.status ?? "pending",
    orderId,
  });
}
