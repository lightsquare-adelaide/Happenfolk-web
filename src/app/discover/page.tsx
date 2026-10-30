import { ArtistTile, CategoryPills, EventTile, SectionHead, WorkTile } from "@/components/discovery/cards";
import {
  avatarUrl,
  categoryNameMap,
  coverUrl,
  loadCategories,
  loadWorksByIds,
  type ArtistCardData,
  type EventCard,
} from "@/components/discovery/data";
import { EmptyState } from "@/components/empty-state";
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { DISCOVERY_QUERY_MAX_BYTES, discoverHref, parseDiscoverParams } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Database } from "@/types/database";

export const metadata = {
  title: `Discover — ${BRAND.name}`,
  description: "Search published events, artists and works on Happenfolk, by keyword and category.",
};

/** Per-group cap: keeps every request bounded; the RPCs clamp it again. */
const GROUP_LIMIT = 12;

type Fn = Database["public"]["Functions"];
type EventHit = Fn["search_events"]["Returns"][number];
type ArtistHit = Fn["search_artists"]["Returns"][number];
type ItemHit = Fn["search_items"]["Returns"][number];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Server-rendered GET search. The URL is the whole state (?q=&category=), so
// results are shareable and the form works without JavaScript. Visibility is
// decided by the search RPCs (published rows, invoker RLS), never by this page.
export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  const { query, queryTooLong, categoryId } = parseDiscoverParams(await searchParams);
  const supabase = await createSupabaseServerClient();
  const categories = await loadCategories(supabase);
  const names = categoryNameMap(categories);
  const active = categoryId === null ? null : categories.find((c) => c.id === categoryId) ?? null;
  const category = active?.id ?? undefined;

  const search = queryTooLong
    ? null
    : await Promise.all([
        supabase.rpc("search_events", { p_query: query ?? "", p_category_id: category, p_limit: GROUP_LIMIT }),
        supabase.rpc("search_artists", { p_query: query ?? "", p_category_id: category, p_limit: GROUP_LIMIT }),
        supabase.rpc("search_items", { p_query: query ?? "", p_category_id: category, p_limit: GROUP_LIMIT }),
      ]);
  const [eventsRes, artistsRes, itemsRes] = search ?? [];
  const failed = [eventsRes, artistsRes, itemsRes].some((res) => res?.error != null);

  const events: EventCard[] = ((eventsRes?.data ?? []) as EventHit[]).map((row) => ({
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    location: row.location,
    coverUrl: coverUrl(supabase, row.cover_path),
    categoryId: row.category_id,
    priceCents: row.price_cents,
    trending: false,
  }));
  const artists: ArtistCardData[] = ((artistsRes?.data ?? []) as ArtistHit[]).map((row) => ({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name?.trim() || row.handle,
    categoryId: row.category_id,
    avatarUrl: avatarUrl(supabase, row.avatar_path),
    publishedItems: null,
    trending: false,
  }));
  const works = await loadWorksByIds(supabase, ((itemsRes?.data ?? []) as ItemHit[]).map((row) => row.id));
  const total = events.length + artists.length + works.length;
  const capped = [events.length, artists.length, works.length].some((n) => n >= GROUP_LIMIT);

  const groups = [
    {
      key: "events", title: "Events", count: events.length, href: "/events", more: "All events",
      body: (
        <ul className="grid min-w-0 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => (
            <li key={event.id} className="min-w-0">
              <EventTile event={event} category={event.categoryId ? names.get(event.categoryId) : undefined} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "artists", title: "Artists", count: artists.length, href: "/artists", more: "All artists",
      body: (
        <ul className="grid min-w-0 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {artists.map((artist) => (
            <li key={artist.id} className="min-w-0">
              <ArtistTile artist={artist} category={artist.categoryId ? names.get(artist.categoryId) : undefined} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "works", title: "Works", count: works.length, href: undefined, more: undefined,
      body: (
        <ul className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {works.map((work) => (
            <li key={work.id} className="min-w-0"><WorkTile work={work} /></li>
          ))}
        </ul>
      ),
    },
  ].filter((group) => group.count > 0);

  const scope = active ? ` in ${active.name}` : "";

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <header className="border-b border-line pb-8 lg:pb-12">
        <p className="mb-4 text-sm text-muted">Discover · South Australia</p>
        <h1 className="display-64">Find the work.</h1>
        <form role="search" action="/discover" method="get" className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {active ? <input type="hidden" name="category" value={active.id} /> : null}
          <Field label="Search events, artists and works">
            <input type="search" name="q" defaultValue={query ?? ""} autoComplete="off"
              maxLength={DISCOVERY_QUERY_MAX_BYTES} placeholder="A name, a title, a medium" className={inputClass} />
          </Field>
          <button type="submit" className={primaryButtonClass}>Search</button>
        </form>
      </header>

      <nav aria-label="Filter results by category" className="mt-8">
        <CategoryPills categories={categories} activeId={active?.id ?? null} hrefFor={(id) => discoverHref(query, id)} />
      </nav>

      <div className="mt-10 lg:mt-12" aria-live="polite">
        {queryTooLong ? (
          <div role="alert" className="border border-line bg-surface p-6">
            <h2 className="text-2xl">That search is too long.</h2>
            <p className="mt-2 text-sm leading-7 text-muted">Try a shorter phrase, a name or a few key words.</p>
          </div>
        ) : failed ? (
          <div role="alert" className="border border-line bg-surface p-6">
            <h2 className="text-2xl">Search could not be completed.</h2>
            <p className="mt-2 text-sm leading-7 text-muted">Please try again in a moment.</p>
            <Link prefetch={false} href={discoverHref(query, active?.id ?? null)} className={`${secondaryButtonClass} mt-4`}>Try again</Link>
          </div>
        ) : total === 0 ? (
          query ? (
            <EmptyState title={`Nothing matches “${query}”${scope}.`}
              hint={active ? "Check the spelling, try a broader word, or search every category." : "Check the spelling or try a broader word. Searches match titles, names and descriptions."}
              action={active ? { href: discoverHref(query, null), label: "Search all categories" } : { href: "/artists", label: "Browse artists" }} />
          ) : (
            <EmptyState title={active ? `Nothing published in ${active.name} yet.` : "Nothing has been published yet."}
              hint="New events, artists and works appear here as soon as they are published."
              action={active ? { href: "/discover", label: "See everything" } : { href: "/register", label: "Create account" }} />
          )
        ) : (
          <>
            <p className="mb-10 text-sm text-muted">
              {query ? `${total} ${total === 1 ? "result" : "results"} for “${query}”${scope}.` : `Showing the latest${scope}.`}
              {capped ? " Each group shows its first 12; refine the search to narrow it." : ""}
            </p>
            <div className="flex flex-col gap-14 lg:gap-20">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`${group.key}-heading`}>
                  <SectionHead id={`${group.key}-heading`} title={group.title} note={`${group.count} found`}
                    href={group.href} linkLabel={group.more} />
                  {group.body}
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
