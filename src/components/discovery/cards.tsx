import Link from "next/link";
import { formatEventDate } from "@/lib/dashboard";
import { initials } from "@/lib/discovery";
import type { ArtistCardData, EventCard, WorkCardData } from "./data";

/* Cards share one rule: the image box has a fixed aspect ratio, so the layout
   never shifts when pictures arrive, and the whole card is one link. */

const day = new Intl.DateTimeFormat("en-AU", { day: "2-digit", timeZone: "Australia/Adelaide" });
const month = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "Australia/Adelaide" });

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-text">
      <span aria-hidden="true" className="h-1.5 w-1.5 bg-brand" />
      {children}
    </span>
  );
}

export function EventTile({ event, category, eager = false }: {
  event: EventCard; category?: string; eager?: boolean;
}) {
  return (
    <Link prefetch={false} href={`/events/${event.id}`} className="group block min-w-0 outline-offset-4">
      <div className="flex aspect-[16/10] items-center justify-center overflow-hidden border border-line bg-tint">
        {event.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public, metadata-stripped event cover
          <img src={event.coverUrl} alt={`${event.title} event cover`} width={1080} height={675}
            loading={eager ? "eager" : "lazy"} decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]" />
        ) : (
          <div aria-hidden="true" className="flex items-end gap-3 px-5">
            <span className="font-display text-7xl leading-none">{day.format(new Date(event.startsAt))}</span>
            <span className="pb-1 text-sm uppercase tracking-wider text-muted">{month.format(new Date(event.startsAt))}</span>
          </div>
        )}
      </div>
      <div className="mt-4 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1">
        {category ? <p className="text-xs text-muted">{category}</p> : null}
        {event.trending ? <Tag>Trending</Tag> : null}
      </div>
      <h3 className="mt-2 break-words font-sans text-xl font-medium leading-7 underline-offset-4 group-hover:underline">{event.title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        <time dateTime={event.startsAt}>{formatEventDate(event.startsAt)}</time>
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-muted">{event.location || "Location to be confirmed"}</p>
    </Link>
  );
}

export function ArtistTile({ artist, category, eager = false }: {
  artist: ArtistCardData; category?: string; eager?: boolean;
}) {
  return (
    <Link prefetch={false} href={`/artists/${encodeURIComponent(artist.handle)}`} className="group block min-w-0 outline-offset-4">
      <div className="flex aspect-square items-center justify-center overflow-hidden border border-line bg-tint">
        {artist.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public artist avatar
          <img src={artist.avatarUrl} alt={`${artist.displayName}'s avatar`} width={320} height={320}
            loading={eager ? "eager" : "lazy"} decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]" />
        ) : (
          <span aria-hidden="true" className="font-display text-7xl leading-none text-muted">{initials(artist.displayName)}</span>
        )}
      </div>
      <div className="mt-4 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1">
        {category ? <p className="text-xs text-muted">{category}</p> : null}
        {artist.trending ? <Tag>Trending</Tag> : null}
      </div>
      <h3 className="mt-2 break-words font-sans text-xl font-medium leading-7 underline-offset-4 group-hover:underline">{artist.displayName}</h3>
      <p className="mt-1 break-all font-mono text-xs leading-6 text-muted">@{artist.handle}</p>
      {artist.publishedItems !== null ? (
        <p className="mt-1 text-sm leading-6 text-muted">
          {artist.publishedItems} {artist.publishedItems === 1 ? "published work" : "published works"}
        </p>
      ) : null}
    </Link>
  );
}

export function WorkTile({ work, className = "", eager = false }: {
  work: WorkCardData; className?: string; eager?: boolean;
}) {
  const href = /^[0-9a-f-]{36}$/i.test(work.id)
    ? `/items/${encodeURIComponent(work.id)}`
    : `/artists/${encodeURIComponent(work.artistHandle)}`;
  return (
    <Link prefetch={false} href={href}
      className={`group block min-w-0 outline-offset-4 ${className}`}>
      <div className="flex aspect-[4/5] items-center justify-center overflow-hidden border border-line bg-tint">
        {work.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public portfolio cover
          <img src={work.coverUrl} alt={work.alt} width={work.width ?? 800} height={work.height ?? 1000}
            loading={eager ? "eager" : "lazy"} decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-[1.03]" />
        ) : (
          <span className="px-4 text-center text-sm text-muted">Media preview unavailable</span>
        )}
      </div>
      <h3 className="mt-3 break-words font-sans text-base font-medium leading-6 underline-offset-4 group-hover:underline">{work.title}</h3>
      <p className="mt-0.5 break-words text-sm leading-6 text-muted">{work.artistName}</p>
    </Link>
  );
}

/** Section heading row: display title on the left, an onward link on the right. */
export function SectionHead({ id, title, note, href, linkLabel }: {
  id: string; title: string; note?: string; href?: string; linkLabel?: string;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="display-32 md:display-48">{title}</h2>
        {note ? <p className="mt-3 max-w-[60ch] text-sm leading-6 text-muted">{note}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link prefetch={false} href={href} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 outline-offset-4">
          {linkLabel}
          <span aria-hidden="true" className="ml-2">→</span>
        </Link>
      ) : null}
    </div>
  );
}

/** Category pills as real links (work without JavaScript); the active one is marked. */
export function CategoryPills({ categories, activeId, hrefFor, allLabel = "All" }: {
  categories: Array<{ id: number; name: string }>;
  activeId: number | null;
  hrefFor: (id: number | null) => string;
  allLabel?: string;
}) {
  const base = "inline-flex min-h-11 items-center border px-4 text-sm font-medium outline-offset-4 transition-colors";
  const on = "border-foreground bg-foreground text-background";
  const off = "border-line-strong bg-background text-foreground hover:bg-surface";
  return (
    <ul aria-label="Categories" className="flex flex-wrap gap-2">
      <li>
        <Link prefetch={false} href={hrefFor(null)} aria-current={activeId === null ? "true" : undefined}
          className={`${base} ${activeId === null ? on : off}`}>{allLabel}</Link>
      </li>
      {categories.map((category) => (
        <li key={category.id}>
          <Link prefetch={false} href={hrefFor(category.id)} aria-current={activeId === category.id ? "true" : undefined}
            className={`${base} ${activeId === category.id ? on : off}`}>{category.name}</Link>
        </li>
      ))}
    </ul>
  );
}
