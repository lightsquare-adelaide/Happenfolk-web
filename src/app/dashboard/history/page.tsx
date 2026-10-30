import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { BRAND } from "@/lib/brand";
import { formatEventDate, registrationStatusLabel } from "@/lib/dashboard";
import {
  eventStatusText,
  historyLink,
  hostedInvolvementLabel,
  splitHistoryTimeline,
} from "@/lib/history";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: `History — ${BRAND.name}` };

/** One event in the member's participation history. */
type HistoryEntry = {
  key: string;
  kind: "hosted" | "registered";
  startsAt: string | null;
  title: string | null;
  event: { id: string; status: string } | null;
  /** Host/Collaborator plus event status for roster rows. */
  involvement?: string;
  /** Registration status for registration rows. */
  registrationStatus?: string;
  /** Latest order status for paid registrations. */
  orderStatus?: string;
};

/**
 * Participation history (W2): every event the signed-in member hosted,
 * collaborated on or registered for, split into Upcoming and Past.
 * All reads go through the member's own session client — RLS decides
 * what is visible, so events hidden from this member never leak here.
 */
export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fdashboard%2Fhistory");

  // (a) Events the member hosts or collaborates on, at any status the
  // member can see. RLS keeps other teams' drafts out of the join.
  const { data: roster, error: rosterError } = await supabase
    .from("event_collaborators")
    .select("event_id, role")
    .eq("profile_id", user.id);
  const rosterByEvent = new Map((roster ?? []).map((row) => [row.event_id, row.role]));
  const hostedResult = rosterByEvent.size
    ? await supabase.from("events")
      .select("id, title, status, starts_at, host_id")
      .in("id", [...rosterByEvent.keys()])
    : { data: [], error: null };

  // (b) Events the member registered for, with the latest order where
  // the event was paid.
  const { data: registrations, error: registrationsError } = await supabase
    .from("event_registrations")
    .select("id, event_id, status")
    .eq("member_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const registrationRows = registrations ?? [];
  const registeredEventIds = [...new Set(registrationRows.map((row) => row.event_id))];
  const registeredResult = registeredEventIds.length
    ? await supabase.from("events")
      .select("id, title, status, starts_at, host_id")
      .in("id", registeredEventIds)
    : { data: [], error: null };
  const registrationIds = registrationRows.map((row) => row.id);
  const ordersResult = registrationIds.length
    ? await supabase.from("orders")
      .select("registration_id, status, created_at")
      .eq("member_id", user.id)
      .in("registration_id", registrationIds)
      .order("created_at", { ascending: false })
    : { data: [], error: null };
  const latestOrderByRegistration = new Map<string, string>();
  for (const order of ordersResult.data ?? []) {
    if (!latestOrderByRegistration.has(order.registration_id)) {
      latestOrderByRegistration.set(order.registration_id, order.status);
    }
  }

  const failed = rosterError != null || hostedResult.error != null
    || registrationsError != null || registeredResult.error != null || ordersResult.error != null;

  const entries: HistoryEntry[] = failed ? [] : [
    ...(hostedResult.data ?? []).map((event) => ({
      key: `hosted:${event.id}`,
      kind: "hosted" as const,
      startsAt: event.starts_at,
      title: event.title,
      event: { id: event.id, status: event.status },
      involvement: `${hostedInvolvementLabel(
        rosterByEvent.get(event.id) ?? "collaborator",
        event.host_id === user.id,
      )} · ${eventStatusText(event.status)}`,
    })),
    ...registrationRows.map((registration) => {
      // RLS may hide a registered event (cancelled or hidden after the
      // member signed up); its details must not leak.
      const event = (registeredResult.data ?? []).find((row) => row.id === registration.event_id);
      return {
        key: `registered:${registration.id}`,
        kind: "registered" as const,
        startsAt: event?.starts_at ?? null,
        title: event?.title ?? null,
        event: event ? { id: event.id, status: event.status } : null,
        registrationStatus: registrationStatusLabel(registration.status),
        orderStatus: latestOrderByRegistration.get(registration.id),
      };
    }),
  ];
  const timeline = splitHistoryTimeline(entries, new Date());
  const totalCount = entries.length;

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">Back to your studio</Link>
      <header className="mt-7 max-w-3xl border-b border-line pb-8">
        <p className="mb-4 text-sm uppercase tracking-wider text-brand-text">Your studio · Events</p>
        <h1 className="font-display text-5xl leading-none md:text-[64px]">History.</h1>
        <p className="mt-5 text-base leading-7 text-muted">
          Events you hosted, collaborated on or registered for — upcoming first, then the past.
        </p>
      </header>
      {failed ? (
        <p role="alert" className="mt-8 border border-danger bg-danger-soft p-5 text-danger">
          Could not load your history. Refresh to try again.
        </p>
      ) : totalCount === 0 ? (
        <div className="mt-10">
          <EmptyState
            title="Your history starts with your first event."
            hint="Host an event, join a collaboration, or save your place at an artist-led gathering."
            action={{ href: "/events", label: "Explore events" }} />
        </div>
      ) : (
        <>
          <HistorySection title="Upcoming" empty="Nothing upcoming." entries={timeline.upcoming} />
          <HistorySection title="Past" empty="Nothing here yet." entries={timeline.past} />
          {timeline.unavailable.length ? (
            <section aria-label="No longer visible" className="mt-12">
              <h2 className="font-display text-[32px] leading-tight">No longer visible</h2>
              <ul className="mt-5 divide-y divide-line border-y border-line">
                {timeline.unavailable.map((entry) => (
                  <li key={entry.key} className="py-5">
                    <p className="font-medium">Event unavailable</p>
                    <p className="mt-1 text-sm text-muted">
                      Registered · {entry.registrationStatus ?? "status unavailable"} — this event is no longer published.
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function HistorySection({ title, empty, entries }: {
  title: string; empty: string; entries: HistoryEntry[];
}) {
  return (
    <section aria-label={title} className="mt-12 first-of-type:mt-10">
      <h2 className="font-display text-[32px] leading-tight">
        {title}
        {entries.length ? <span className="ml-3 font-sans text-sm text-muted">{entries.length}</span> : null}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {entries.map((entry) => {
            const link = historyLink(entry.event);
            const detail = entry.kind === "hosted"
              ? entry.involvement
              : ["Registered · " + entry.registrationStatus, entry.orderStatus ? `Order: ${entry.orderStatus}` : null]
                .filter(Boolean).join(" · ");
            const body: ReactNode = (
              <>
                {entry.startsAt ? <p className="mt-1 text-sm text-muted">{formatEventDate(entry.startsAt)}</p> : null}
                <p className="mt-2 text-sm">{detail}</p>
              </>
            );
            return (
              <li key={entry.key} className="py-6">
                {entry.title == null ? (
                  <div>
                    <p className="font-medium">Event unavailable</p>
                    {body}
                  </div>
                ) : link ? (
                  <div>
                    <Link prefetch={false} href={link.href} className="break-words font-medium underline-offset-4 hover:underline">{entry.title}</Link>
                    {body}
                    <Link prefetch={false} href={link.href} className="mt-2 inline-block text-sm underline underline-offset-4">{link.label}</Link>
                  </div>
                ) : (
                  <div>
                    <p className="break-words font-medium">{entry.title}</p>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
