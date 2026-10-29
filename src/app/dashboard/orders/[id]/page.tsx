import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { formatEventDate, registrationStatusLabel } from "@/lib/dashboard";
import { isUuid } from "@/lib/registration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GatewayControls } from "@/components/gateway-controls";
import { CancelRegistrationForm } from "../../registrations/cancel-form";

export const metadata = { title: `Simulated payment · ${BRAND.name}` };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/dashboard/orders/${id}`)}`);
  if (!isUuid(id)) notFound();

  const { data: order, error: orderError } = await supabase.from("orders")
    .select("id, registration_id, amount_cents, status, created_at")
    .eq("id", id).eq("member_id", user.id).maybeSingle();
  if (orderError) throw new Error("Could not load your order");
  if (!order) notFound();
  const { data: registration, error: registrationError } = await supabase.from("event_registrations")
    .select("id, status, event_id").eq("id", order.registration_id).eq("member_id", user.id).maybeSingle();
  if (registrationError) throw new Error("Could not load your registration");
  if (!registration) notFound();
  const { data: event, error: eventError } = await supabase.from("events")
    .select("id, title").eq("id", registration.event_id).maybeSingle();
  if (eventError) throw new Error("Could not load the event");

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <p data-testid="simulated-payment-banner" className="border border-warning bg-warning-soft px-5 py-4 text-sm font-medium text-warning">
        Simulated payment — no money moves and no card details are collected.
      </p>
      <header className="mt-8 max-w-3xl border-b border-line pb-8">
        <p className="mb-4 text-sm uppercase tracking-wider text-brand-text">Your studio · Orders</p>
        <h1 className="font-display text-5xl leading-none md:text-[64px]">Simulated payment.</h1>
        <p className="mt-5 text-lg">{event ? <Link href={`/events/${event.id}`} className="underline underline-offset-4">{event.title}</Link> : "Event unavailable"}</p>
      </header>
      <section aria-label="Order details" className="mt-8 max-w-3xl space-y-5 border border-line bg-surface p-6 sm:p-8">
        <p className="break-all text-sm text-muted">Order {order.id} · {formatEventDate(order.created_at)}</p>
        <p>Amount: <strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(order.amount_cents / 100)}</strong></p>
        <p>Order status: <strong>{order.status}</strong></p>
        <p>Registration: <strong>{registrationStatusLabel(registration.status)}</strong></p>
        <GatewayControls key={`${order.id}:${order.status}:${registration.status}`} orderId={order.id} eventId={registration.event_id} orderStatus={order.status} registrationStatus={registration.status} />
        {registration.status !== "cancelled" ? <CancelRegistrationForm registrationId={registration.id} /> : null}
      </section>
    </main>
  );
}
