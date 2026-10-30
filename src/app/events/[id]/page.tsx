import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryButtonClass, secondaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { googleMapsSearchUrl } from "@/lib/maps";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ViewTracker } from "@/components/view-tracker";

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const getEvent = cache(async (id: string) => {
  if (!uuid.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from(user ? "events" : "public_events")
    .select("id, title, description, location, starts_at, ends_at, cover_path, status, host_id, category_id, price_cents")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this event");
  return data;
});

export async function generateMetadata({ params }: Context) {
  const event = await getEvent((await params).id);
  return { title: `${event?.title ?? "Event not found"} — ${BRAND.name}` };
}

// Reuses the personal detail page's event, location and artist relationship;
// commerce and registration controls are outside the confirmed scope.
export default async function EventPage({ params }: Context) {
  const event = await getEvent((await params).id);
  if (!event) notFound();
  const supabase = await createSupabaseServerClient();
  const [host, category, account] = await Promise.all([
    supabase.from("profiles").select("handle, display_name, published").eq("id", event.host_id).maybeSingle(),
    event.category_id
      ? supabase.from("categories").select("name").eq("id", event.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.auth.getUser(),
  ]);
  let canEdit = account.data.user?.id === event.host_id;
  if (account.data.user && !canEdit) {
    const membership = await supabase.from("event_collaborators").select("profile_id")
      .eq("event_id", event.id).eq("profile_id", account.data.user.id).maybeSingle();
    canEdit = membership.data != null;
  }
  const coverUrl = event.cover_path
    ? supabase.storage.from("covers").getPublicUrl(event.cover_path).data.publicUrl : null;
  // The Maps URL encodes the venue, so the anchor renders only for
  // signed-in viewers; the anonymous branch below renders neither the
  // venue nor any link carrying it. Anonymous reads go through the
  // public_events view where location is null anyway, which makes
  // mapsUrl null a second time.
  const mapsUrl = googleMapsSearchUrl(event.location);

  return (
    <main className="shell-wrap py-8 lg:py-12">
      {event.status === "published" ? <ViewTracker subjectType="event" subjectId={event.id} /> : null}
      <nav aria-label="Event navigation" className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Link href="/events" className="py-2 text-sm underline underline-offset-4">All events</Link>
        {canEdit ? <Link prefetch={false} href="/dashboard/events" className={secondaryButtonClass}>Edit event</Link> : null}
      </nav>
      {event.status !== "published" ? (
        <div role="status" className="mb-8 border border-line bg-surface px-5 py-4 text-sm leading-6">
          {event.status === "draft" ? "Draft — only the host and listed collaborators can see this event." : "Cancelled — this page is visible to the event team."}
        </div>
      ) : null}
      <header className="grid min-w-0 gap-8 border-y border-line py-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-14 lg:py-10">
        <div className="min-w-0">
          <p className="mb-4 text-sm text-muted">{category.data?.name ?? "Artist-led event"}</p>
          <h1 className="break-words font-display text-5xl leading-[1.05] tracking-tight md:text-[64px]">{event.title}</h1>
          {event.description ? <p className="mt-6 max-w-[60ch] whitespace-pre-line break-words text-base leading-8 text-muted">{event.description}</p> : null}
        </div>
        <dl className="min-w-0 space-y-6 md:border-l md:border-line md:pl-8">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">When</dt>
            <dd className="mt-2 text-base leading-7"><time dateTime={event.starts_at}>{formatEventDate(event.starts_at)}</time>
              {event.ends_at ? <><span className="block text-sm text-muted">Until</span><time dateTime={event.ends_at}>{formatEventDate(event.ends_at)}</time></> : null}</dd>
            <dd className="mt-1 text-xs leading-6 text-muted">Australia/Adelaide</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Where</dt>
            <dd className="mt-2 break-words text-base leading-7">
              {account.data.user ? (
                <>
                  {event.location || "Location to be confirmed"}
                  {mapsUrl ? (
                    <>
                      {" "}
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${event.location} in Google Maps`}
                        className="underline underline-offset-4"
                      >
                        Open in Google Maps
                      </a>
                    </>
                  ) : null}
                </>
              ) : (
                <Link href={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`} className="underline underline-offset-4">Sign in to see the venue</Link>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Organised by</dt>
            <dd className="mt-2 break-words text-base leading-7">{host.data ? (
              <Link href={`/artists/${host.data.handle}`} className="underline underline-offset-4">{host.data.display_name}</Link>
            ) : "A member artist whose profile is private"}</dd>
          </div>
        </dl>
      </header>
      {/* Tingxuan: integrated event participation */}
      {event.status === "published" ? (
        <section aria-label="Event participation" className="mt-10 flex flex-col gap-5 border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="min-w-0">
            <h2 className="font-display text-3xl">Take part.</h2>
            <p className="mt-2 text-sm leading-7 text-muted">Manage your place in Your studio → My registrations.</p>
          </div>
          {event.price_cents === 0 ? (
            <Link prefetch={false} href={`/events/${event.id}/participate`} className={primaryButtonClass}>Participate · Free</Link>
          ) : (
            <Link prefetch={false} href={`/events/${event.id}/participate`} className={primaryButtonClass}>Participate · Simulated payment</Link>
          )}
        </section>
      ) : null}
      {coverUrl ? (
        <figure className="mt-8 lg:mt-12">
          <div className="flex items-center justify-center overflow-hidden border border-line bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element -- public cover produced by the bounded image pipeline */}
            <img src={coverUrl} alt={`${event.title} event cover`} width={1080} height={675}
              className="max-h-[40rem] w-full object-contain" />
          </div>
          <figcaption className="mt-3 text-xs leading-6 text-muted">Event cover supplied by the organising artists.</figcaption>
        </figure>
      ) : null}
    </main>
  );
}
