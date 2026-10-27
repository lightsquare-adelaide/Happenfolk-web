import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canRegisterWithoutPayment, isUuid } from "@/lib/registration";
import { formatEventDate } from "@/lib/dashboard";
import { ParticipateForm } from "../../participate-form";

type Props = { params: Promise<{ id: string }> };
export const metadata = { title: `Participate in an event — ${BRAND.name}` };

export default async function ParticipatePage({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const [{ data: event, error }, { data: { user } }] = await Promise.all([
    supabase.from("events").select("id, title, starts_at, status, price_cents").eq("id", id).eq("status", "published").maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (error) throw new Error("Unable to load event participation page");
  if (!event) notFound();
  const path = `/events/${id}/participate`;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Participate: {event.title}</h1>
      <p className="text-muted">{formatEventDate(event.starts_at)}</p>
      {!canRegisterWithoutPayment(event) ? (
        <p className="text-sm" role="status">Paid event booking is not available yet. No payment will be taken.</p>
      ) : !user ? (
        <p><Link className="text-brand-700 underline" href={`/login?next=${encodeURIComponent(path)}`}>Sign in to participate</Link></p>
      ) : (
        <ParticipateForm eventId={event.id} />
      )}
      <Link className="text-sm text-brand-700 underline" href="/dashboard/registrations">My registrations</Link>
    </main>
  );
}
