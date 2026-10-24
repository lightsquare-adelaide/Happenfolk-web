import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DateBlock, LikeButton } from "@/components/event-card";
import { Icon } from "@/components/icons";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { getCategories, getEventLikes, getEvents, getMyLikes, getPeople, priceLabel, type EventCard } from "@/lib/showcase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RLS returns published events, plus drafts to their host and collaborators.
const getEvent = cache(async (id: string): Promise<EventCard | null> => {
  if (!UUID.test(id)) return null;
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("events")
    .select("id, title, description, starts_at, price_cents, capacity, category_id, cover_path, host_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [people, likes] = await Promise.all([getPeople(db, [data.host_id]), getEventLikes(db, id)]);
  const { cover_path, host_id, ...e } = data;
  return {
    ...e,
    coverUrl: cover_path ? db.storage.from("covers").getPublicUrl(cover_path).data.publicUrl : null,
    host: people.get(host_id) ?? null,
    likes,
  };
});

export async function generateMetadata({ params }: Params) {
  const event = await getEvent((await params).id);
  return { title: `${event?.title ?? "Event not found"} — ${BRAND.name}` };
}

export default async function EventPage({ params }: Params) {
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();
  const db = await createSupabaseServerClient();
  const [categories, liked, more] = await Promise.all([
    getCategories(db),
    getMyLikes(db, "event", [event.id]),
    getEvents(db, { limit: 4 }),
  ]);
  const category = categories.find((c) => c.id === event.category_id)?.name;

  return (
    <main className="wrap">
      <div className="crumb">
        <Link href="/events">
          <Icon name="arrowLeft" />
          All events
        </Link>
      </div>

      <div className="event-top">
        <div className="event-media">
          {event.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
            <img src={event.coverUrl} width={1200} height={800} alt={event.title} fetchPriority="high" />
          ) : null}
        </div>

        <div className="event-info">
          {category ? <p className="cat">{category}</p> : null}
          <h1 className="display d48">{event.title}</h1>
          <dl className="facts">
            <dt>
              <Icon name="calendar" />
              <span className="sr-only">Date</span>
            </dt>
            <dd>
              <strong>{formatEventDate(event.starts_at)}</strong>
              Adelaide time
            </dd>
            <dt>
              <Icon name="pin" />
              <span className="sr-only">Venue</span>
            </dt>
            <dd className="locked">Venue and map arrive with the events build</dd>
            <dt>
              <Icon name="ticket" />
              <span className="sr-only">Price</span>
            </dt>
            <dd>
              <strong>{priceLabel(event.price_cents)}</strong>
              {event.capacity ? `${event.capacity} places` : null}
            </dd>
          </dl>
          <div className="counts">
            <LikeButton event={event} liked={liked.has(event.id)} back={`/events/${event.id}`} />
            <span className="btn btn-primary" aria-disabled="true" title="Registration is not live in this preview">
              <Icon name="users" />
              Participate
            </span>
            <span className="soon-tag">Coming soon</span>
          </div>
          <p className="gate-note">Thumbs Up works now. Registration and participant counts are next.</p>
        </div>
      </div>

      <div className="event-body">
        <section className="prose">
          <h2 className="display d32">About</h2>
          {(event.description ?? "").split("\n\n").map((p, i) => (
            <p key={i} className="t20" style={{ marginTop: i ? 16 : 24 }}>
              {p}
            </p>
          ))}
        </section>
        {event.host ? (
          <section>
            <h2 className="display d32">Hosted by</h2>
            <div className="people">
              <div className="person">
                {event.host.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                  <img className="avatar" src={event.host.avatarUrl} width={56} height={56} alt="" />
                ) : (
                  <span />
                )}
                <div>
                  <Link className="name" href={`/artists/${event.host.handle}`}>
                    {event.host.display_name}
                  </Link>
                  <div className="t14 muted">{categories.find((c) => c.id === event.host?.category_id)?.name}</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {more.filter((e) => e.id !== event.id).length ? (
        <section className="more">
          <h2 className="display d32" style={{ marginBottom: 24 }}>
            More events
          </h2>
          <ul className="more-grid">
            {more
              .filter((e) => e.id !== event.id)
              .slice(0, 3)
              .map((e) => (
                <li key={e.id}>
                  <DateBlock iso={e.starts_at} />
                  <div>
                    <Link href={`/events/${e.id}`}>{e.title}</Link>
                    <div className="t14 muted">{priceLabel(e.price_cents)}</div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
