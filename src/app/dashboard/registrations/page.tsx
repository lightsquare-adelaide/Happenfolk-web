import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { formatEventDate, registrationStatusLabel } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CancelRegistrationForm } from "./cancel-form";

export const metadata = { title: `My registrations · ${BRAND.name}` };
type Props = { searchParams: Promise<{ notice?: string }> };

export default async function MyRegistrationsPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fdashboard%2Fregistrations");

  const { data: rows, error } = await supabase.from("event_registrations")
    .select("id, event_id, status, created_at")
    .eq("member_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const eventIds = [...new Set((rows ?? []).map((row) => row.event_id))];
  const eventResults = eventIds.length
    ? await supabase.from("events").select("id, title, starts_at").in("id", eventIds)
    : { data: [], error: null };
  const eventById = new Map((eventResults.data ?? []).map((event) => [event.id, event]));
  const { notice } = await searchParams;
  const notices: Record<string, string> = {
    registered: "Your free event registration is confirmed.",
    cancelled: "Registration cancelled.",
    already_registered: "You are already registered for this event.",
  };

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">Back to your studio</Link>
      <header className="mt-7 max-w-3xl border-b border-line pb-8">
        <p className="mb-4 text-sm uppercase tracking-wider text-brand-text">Your studio · Events</p>
        <h1 className="font-display text-5xl leading-none md:text-[64px]">My registrations.</h1>
        <p className="mt-5 text-base leading-7 text-muted">Your places at artist-led events. Review, or cancel a registration when plans change.</p>
      </header>
      {notice && notices[notice] ? (
        <p role="status" className="mt-8 border border-brand-line bg-brand-soft px-5 py-4 text-sm leading-6 text-foreground">{notices[notice]}</p>
      ) : null}
      {error || eventResults.error ? (
        <p role="alert" className="mt-8 border border-danger bg-danger-soft p-5 text-danger">Could not load your registrations. Refresh to try again.</p>
      ) : rows?.length ? (
        <ul className="mt-10 divide-y divide-line border-y border-line">
          {rows.map((row) => {
            // RLS may hide an unpublished event; its details must not leak.
            const event = eventById.get(row.event_id);
            return (
              <li key={row.id} className="grid min-w-0 gap-5 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0 space-y-2">
                  <h2 className="break-words font-sans text-xl font-semibold">{event?.title ?? "Event unavailable"}</h2>
                  {event?.starts_at ? <p className="text-sm text-muted">{formatEventDate(event.starts_at)}</p> : null}
                  <p className="text-sm">Status: <strong>{registrationStatusLabel(row.status)}</strong></p>
                  {event ? <Link href={`/events/${event.id}`} className="inline-block py-2 text-sm underline underline-offset-4">View event</Link> : null}
                </div>
                {row.status !== "cancelled" ? <CancelRegistrationForm registrationId={row.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-10 border border-line bg-surface p-8">
          <p className="text-lg">You have not registered for any events yet.</p>
          <Link href="/events" className="mt-4 inline-block py-2 text-sm underline underline-offset-4">Explore events</Link>
        </div>
      )}
      {rows?.length === 100 ? <p className="mt-5 text-sm text-muted">Showing the 100 most recent registrations.</p> : null}
    </main>
  );
}
