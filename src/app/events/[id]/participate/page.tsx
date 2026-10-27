import Link from "next/link";
import { notFound } from "next/navigation";
import { secondaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { canRegisterWithoutPayment, isUuid } from "@/lib/registration";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ParticipateForm } from "../../participate-form";

type Props = { params: Promise<{ id: string }> };
export const metadata = { title: `Participate · ${BRAND.name}` };

export default async function ParticipatePage({ params }: Props) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [{ data: event, error }, { data: { user } }] = await Promise.all([
    supabase.from("events")
      .select("id, title, starts_at, status, price_cents, location")
      .eq("id", id).eq("status", "published").maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (error) throw new Error("Unable to load event participation page");
  if (!event) notFound();

  const path = `/events/${id}/participate`;
  return (
    <main className="shell-wrap py-10 lg:py-16">
      <nav aria-label="Participation navigation" className="flex flex-wrap gap-6 text-sm">
        <Link href={`/events/${id}`} className="underline underline-offset-4">Back to event</Link>
        <Link href="/dashboard/registrations" className="underline underline-offset-4">My registrations</Link>
      </nav>
      <header className="mt-8 max-w-4xl border-b border-line pb-10">
        <p className="mb-4 text-sm uppercase tracking-wider text-brand-text">Events · Participation</p>
        <h1 className="font-display text-5xl leading-[1.05] md:text-[64px]">Join the event.</h1>
        <h2 className="mt-6 break-words text-2xl font-semibold md:text-3xl">{event.title}</h2>
        <p className="mt-4 text-sm leading-7 text-muted">{formatEventDate(event.starts_at)} · {event.location || "Location to be confirmed"}</p>
      </header>
      <section aria-label="Free event registration" className="mt-10 max-w-2xl border border-line bg-surface p-6 sm:p-8">
        {!canRegisterWithoutPayment(event) ? (
          <p role="status" className="text-base leading-7">Paid event booking is not available yet. No payment will be taken.</p>
        ) : !user ? (
          <div className="space-y-5">
            <h3 className="font-display text-3xl">Sign in to participate.</h3>
            <p className="leading-7 text-muted">An account is required to save your place and manage your registration.</p>
            <Link className={secondaryButtonClass} href={`/login?next=${encodeURIComponent(path)}`}>
              Log in or create account
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            <h3 className="font-display text-3xl">Reserve your free place.</h3>
            <p className="leading-7 text-muted">You will see your confirmed place in Your studio → My registrations. No payment is required.</p>
            <ParticipateForm eventId={event.id} />
          </div>
        )}
      </section>
    </main>
  );
}
