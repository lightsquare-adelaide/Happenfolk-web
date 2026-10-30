import { isUuid, registrationErrorMessage } from "@/lib/registration";
import { isSameOriginRequest } from "@/lib/request-origin";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LogReason, logApiEvent } from "@/lib/log";

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
    logApiEvent({ event: "order_settle_failed", route: "/api/orders/[id]/settle", status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in to pay" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("outcome" in body) ||
      (body.outcome !== "succeeded" && body.outcome !== "failed")) {
    logApiEvent({ event: "order_settle_failed", route: "/api/orders/[id]/settle", status: 400, reason: LogReason.invalidRequest, userId: user.id });
    return NextResponse.json({ error: "outcome must be succeeded or failed" }, { status: 400 });
  }

  const { data: orderStatus, error } = await supabase.rpc("settle_order", {
    p_order_id: id,
    p_force_fail: body.outcome === "failed",
  });
  if (error || typeof orderStatus !== "string") {
    const message = error?.message ?? "settle_order returned nothing";
    if (message.includes("ORDER_NOT_FOUND_OR_NOT_YOURS")) {
      logApiEvent({ event: "order_settle_failed", route: "/api/orders/[id]/settle", status: 404, reason: LogReason.ownershipDenied, userId: user.id });
      return NextResponse.json({ error: "Order not found or not yours" }, { status: 404 });
    }
    if (message.includes("REGISTRATION_CANCELLED")) {
      return NextResponse.json({ error: registrationErrorMessage(message) }, { status: 409 });
    }
    logApiEvent({ event: "order_settle_failed", route: "/api/orders/[id]/settle", status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Settlement failed; please try again later" }, { status: 500 });
  }

  const { data: order } = await supabase
    .from("orders")
    .select("registration_id, status")
    .eq("id", id)
    .maybeSingle();
  const registration = order
    ? (
        await supabase
          .from("event_registrations")
          .select("status")
          .eq("id", order.registration_id)
          .maybeSingle()
      ).data
    : null;

  return NextResponse.json({
    ok: true,
    orderStatus,
    registrationStatus: registration?.status ?? null,
  });
}
