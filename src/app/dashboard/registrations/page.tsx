import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { formatEventDate, registrationStatusLabel } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CancelRegistrationForm } from "./cancel-form";

export const metadata = { title: `My registrations — ${BRAND.name}` };

type Props = { searchParams: Promise<{ notice?: string }> };

export default async function MyRegistrationsPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fdashboard%2Fregistrations");

  const { data: rows, error } = await supabase
    .from("event_registrations")
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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-10">
      <h1 className="text-2xl font-semibold">My registrations</h1>
      <Link href="/dashboard" className="text-sm text-brand-700 underline">Back to dashboard</Link>
      {notice && notices[notice] ? <p role="status" className="text-sm">{notices[notice]}</p> : null}
      {error || eventResults.error ? (
        <p role="alert" className="text-red-600">Could not load your registrations. Please refresh to try again.</p>
      ) : rows?.length ? (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => {
            // RLS may hide an event that became unpublished; never leak its title.
            const event = eventById.get(row.event_id);
            return (
              <li key={row.id} className="flex flex-col gap-2 rounded-lg border border-line p-4">
                <h2 className="font-medium">{event?.title ?? "Event unavailable"}</h2>
                {event?.starts_at ? <p className="text-sm text-muted">{formatEventDate(event.starts_at)}</p> : null}
                <p className="text-sm">Status: {registrationStatusLabel(row.status)}</p>
                {row.status !== "cancelled" ? <CancelRegistrationForm registrationId={row.id} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">You have not registered for any events yet.</p>
      )}
      {rows?.length === 100 ? <p className="text-sm text-muted">Showing the 100 most recent registrations.</p> : null}
    </main>
  );
}
