import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { primaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RetryEvents } from "./retry-events";

export const metadata = { title: `Events — ${BRAND.name}` };

type ListedEvent = {
  id: string; title: string; location: string | null;
  starts_at: string; cover_path: string | null; category_id: number | null;
};
const fields = "id, title, location, starts_at, cover_path, category_id";
const day = new Intl.DateTimeFormat("en-AU", { day: "2-digit", timeZone: "Australia/Adelaide" });
const month = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric", timeZone: "Australia/Adelaide" });

// Adapted from the personal implementation's cover-led public event index.
// The directory is always public-only; private planning lives in the studio.
export default async function EventsPage() {
  const supabase = await createSupabaseServerClient();
  const now = new Date().toISOString();
  const [upcoming, recent, categories, account] = await Promise.all([
    supabase.from("events").select(fields).eq("status", "published").gte("starts_at", now)
      .order("starts_at").order("id").limit(24),
    supabase.from("events").select(fields).eq("status", "published").lt("starts_at", now)
      .order("starts_at", { ascending: false }).order("id").limit(12),
    supabase.from("categories").select("id, name"),
    supabase.auth.getUser(),
  ]);
  const categoryNames = new Map((categories.data ?? []).map(category => [category.id, category.name]));
  const failed = upcoming.error != null || recent.error != null;
  const groups = [
    { title: "Coming up", events: (upcoming.data ?? []) as ListedEvent[] },
    { title: "Recent events", events: (recent.data ?? []) as ListedEvent[] },
  ];
  const empty = groups.every(group => group.events.length === 0);
  const action = account.data.user
    ? { href: "/dashboard/events", label: "Manage events" }
    : { href: "/login?next=%2Fdashboard%2Fevents", label: "Create an event" };

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <header className="grid gap-6 border-b border-line pb-8 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:pb-12">
        <div className="min-w-0">
          <p className="mb-4 text-sm text-muted">Events · South Australia</p>
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight md:text-[64px]">Make time for art.</h1>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-5 md:justify-end">
          <p className="max-w-[42ch] text-base leading-7 text-muted">Exhibitions, performances and artist-led gatherings. Find a place to be part of the work.</p>
          <Link prefetch={false} href={action.href} className={primaryButtonClass}>{action.label}</Link>
        </div>
      </header>
      <p className="mt-5 text-sm leading-6 text-muted">All event times are shown in Australia/Adelaide.</p>
      {failed ? (
        <div role="alert" className="mt-10 border border-line bg-surface p-6">
          <h2 className="text-2xl">Events could not be loaded.</h2>
          <p className="mt-2 text-sm leading-7 text-muted">Please try again in a moment.</p>
          <div className="mt-4"><RetryEvents /></div>
        </div>
      ) : empty ? (
        <div className="mt-10"><EmptyState title="The next gathering starts with an idea."
          hint="No public events have been shared yet. Artists can create one in their studio." action={action} /></div>
      ) : groups.filter(group => group.events.length).map(group => (
        <section key={group.title} aria-label={group.title} className="mt-10 lg:mt-14">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="font-display text-[32px] leading-tight md:text-5xl">{group.title}</h2>
            <p className="text-xs text-muted">{group.events.length} {group.events.length === 1 ? "event" : "events"}</p>
          </div>
          <ul className="grid min-w-0 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {group.events.map((event, index) => {
              const coverUrl = event.cover_path
                ? supabase.storage.from("covers").getPublicUrl(event.cover_path).data.publicUrl : null;
              return (
                <li key={event.id} className="min-w-0">
                  <Link prefetch={false} href={`/events/${event.id}`} className="group block min-w-0 outline-offset-4">
                    <div className="flex aspect-[16/10] items-center justify-center overflow-hidden border border-line bg-surface">
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- public, metadata-stripped event cover
                        <img src={coverUrl} alt={`${event.title} event cover`} width={1080} height={675}
                          loading={group.title === "Coming up" && index < 3 ? "eager" : "lazy"}
                          className="h-full w-full object-cover" />
                      ) : (
                        <div aria-hidden="true" className="flex items-end gap-4 px-5 py-8">
                          <span className="font-display text-7xl leading-none">{day.format(new Date(event.starts_at))}</span>
                          <span className="pb-1 text-sm uppercase tracking-wider text-muted">{month.format(new Date(event.starts_at))}</span>
                        </div>
                      )}
                    </div>
                    {event.category_id && categoryNames.get(event.category_id) ? (
                      <p className="mt-4 text-xs text-muted">{categoryNames.get(event.category_id)}</p>
                    ) : null}
                    <h3 className="mt-3 break-words font-sans text-xl font-medium leading-7 underline-offset-4 group-hover:underline">{event.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted"><time dateTime={event.starts_at}>{formatEventDate(event.starts_at)}</time></p>
                    <p className="mt-1 break-words text-sm leading-6 text-muted">{event.location || "Location to be confirmed"}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
