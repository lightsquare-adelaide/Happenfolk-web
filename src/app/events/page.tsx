import Link from "next/link";
import { DateBlock } from "@/components/event-card";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { getCategories, getEvents, priceLabel } from "@/lib/showcase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: `Events — ${BRAND.name}` };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const db = await createSupabaseServerClient();
  const [categories, events] = await Promise.all([getCategories(db), getEvents(db)]);
  return (
    <main className="wrap">
      <header className="page-head">
        <h1 className="display d64">Events</h1>
        <p className="t20 muted">What’s on from South Australian artists. Times are Adelaide time.</p>
      </header>
      {events.length === 0 ? (
        <p className="empty">No upcoming events yet.</p>
      ) : (
        <ul className="ev-list">
          {events.map((e) => (
            <li key={e.id}>
              <DateBlock iso={e.starts_at} />
              <div className="grow">
                <Link href={`/events/${e.id}`}>{e.title}</Link>
                <div className="meta">
                  <span>{categories.find((c) => c.id === e.category_id)?.name}</span>
                  <span>{formatEventDate(e.starts_at)}</span>
                  <span>{priceLabel(e.price_cents)}</span>
                  {e.host ? <span>by {e.host.display_name}</span> : null}
                </div>
              </div>
              <Link className="btn btn-ghost" href={`/events/${e.id}`}>
                View event
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
