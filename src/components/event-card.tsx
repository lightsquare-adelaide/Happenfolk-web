import Link from "next/link";
import { toggleEventLike } from "@/app/events/actions";
import { Icon } from "@/components/icons";
import { formatEventDate } from "@/lib/dashboard";
import { dateParts, priceLabel, type Category, type EventCard } from "@/lib/showcase";

export function LikeButton({ event, liked, back }: { event: EventCard; liked: boolean; back: string }) {
  return (
    <form action={toggleEventLike}>
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        className={`btn thumbs ${liked ? "btn-primary on" : "btn-ghost"}`}
        aria-pressed={liked}
        aria-label={`Thumbs up, ${event.likes}`}
      >
        <Icon name="thumbsUp" />
        {event.likes}
      </button>
    </form>
  );
}

export function DateBlock({ iso }: { iso: string }) {
  const { day, month } = dateParts(iso);
  return (
    <div className="date-block" aria-hidden="true">
      <b>{day}</b>
      <small>{month}</small>
    </div>
  );
}

export function EventFeedCard({ event, categories, liked }: { event: EventCard; categories: Category[]; liked: boolean }) {
  const category = categories.find((c) => c.id === event.category_id)?.name;
  return (
    <article className="event-card">
      {event.coverUrl ? (
        <Link href={`/events/${event.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL; no image loader configured */}
          <img src={event.coverUrl} width={1360} height={765} alt={event.title} loading="lazy" />
        </Link>
      ) : null}
      <div className="body">
        <div className="meta">
          {category ? <span>{category}</span> : null}
          <span>
            <Icon name="calendar" />
            {formatEventDate(event.starts_at)}
          </span>
          <span>{priceLabel(event.price_cents)}</span>
        </div>
        <h3 className="display d32">
          <Link href={`/events/${event.id}`}>{event.title}</Link>
        </h3>
        {event.host ? (
          <p>
            Hosted by <Link href={`/artists/${event.host.handle}`}>{event.host.display_name}</Link>
          </p>
        ) : null}
        <div className="post-actions">
          <LikeButton event={event} liked={liked} back="/" />
          <Link className="btn btn-ghost" href={`/events/${event.id}`}>
            View event
          </Link>
        </div>
      </div>
    </article>
  );
}
