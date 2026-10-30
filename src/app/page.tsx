import Link from "next/link";
import { ArtistTile, EventTile, SectionHead } from "@/components/discovery/cards";
import {
  categoryNameMap,
  loadCategories,
  loadHomeArtists,
  loadHomeEvents,
  loadRecentWorks,
} from "@/components/discovery/data";
import { EmptyState } from "@/components/empty-state";
import { Hero } from "@/components/home/hero";
import { WorksStrip } from "@/components/home/works-strip";
import { discoverHref } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EVENT_COUNT = 6;
const ARTIST_COUNT = 8;
const WORK_COUNT = 12;

// Public discovery home. Anonymous visitors get the global trending views;
// a signed-in member gets the same feeds through recommended_* ("For you").
// When nothing has been viewed yet the sections say so and fall back to the
// newest published records, never an empty block and never a made-up ranking.
export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = user != null;

  const [events, artists, recent, categories] = await Promise.all([
    loadHomeEvents(supabase, signedIn, EVENT_COUNT),
    loadHomeArtists(supabase, signedIn, ARTIST_COUNT),
    loadRecentWorks(supabase, WORK_COUNT),
    loadCategories(supabase),
  ]);
  const names = categoryNameMap(categories);

  const eventsTitle = signedIn ? "Events for you" : events.isTrending ? "Trending events" : "Latest events";
  const eventsNote = events.isTrending
    ? signedIn
      ? "Upcoming events ranked by this week's views and the categories you spend time in."
      : "Upcoming events with the most views over the past seven days."
    : "Upcoming events, newest listings first. Popularity ranking begins once events are viewed.";
  const artistsTitle = signedIn ? "Artists for you" : artists.isTrending ? "Trending artists" : "New artists";
  const artistsNote = artists.isTrending
    ? signedIn
      ? "Artists ranked by this week's profile views and the categories you spend time in."
      : "Artists whose profiles were viewed most over the past seven days."
    : "Recently published profiles. Popularity ranking begins once profiles are viewed.";

  return (
    <main className="flex flex-1 flex-col">
      <Hero works={recent.works} />

      <section aria-labelledby="works-heading" className="shell-wrap pt-14 lg:pt-20">
        <SectionHead id="works-heading" title="Fresh on the wall"
          note="The newest published work, straight from artists' portfolios."
          href="/discover" linkLabel="Search all work" />
        {recent.works.length > 0 ? (
          <WorksStrip works={recent.works} />
        ) : (
          <EmptyState title="No work has been published yet."
            hint="Portfolio pieces appear here the moment an artist publishes them."
            action={{ href: "/artists", label: "Browse artists" }} />
        )}
      </section>

      <section aria-labelledby="events-heading" className="shell-wrap pt-14 lg:pt-20">
        <SectionHead id="events-heading" title={eventsTitle} note={eventsNote} href="/events" linkLabel="All events" />
        {events.cards.length > 0 ? (
          <ul className="grid min-w-0 gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {events.cards.map((event, index) => (
              <li key={event.id} className="min-w-0">
                <EventTile event={event} eager={index < 3}
                  category={event.categoryId ? names.get(event.categoryId) : undefined} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={events.failed ? "Events could not be loaded." : "No upcoming events yet."}
            hint={events.failed ? "Please refresh in a moment." : "Artists publish events from their studio. They will appear here as soon as they do."}
            action={{ href: "/events", label: "See all events" }} />
        )}
      </section>

      <section aria-labelledby="artists-heading" className="shell-wrap pt-14 lg:pt-20">
        <SectionHead id="artists-heading" title={artistsTitle} note={artistsNote} href="/artists" linkLabel="All artists" />
        {artists.cards.length > 0 ? (
          <ul className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
            {artists.cards.map((artist, index) => (
              <li key={artist.id} className="min-w-0">
                <ArtistTile artist={artist} eager={index < 4}
                  category={artist.categoryId ? names.get(artist.categoryId) : undefined} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={artists.failed ? "Artists could not be loaded." : "No artists have published a profile yet."}
            hint={artists.failed ? "Please refresh in a moment." : "Profiles appear here as soon as an artist publishes."}
            action={{ href: "/register", label: "Create account" }} />
        )}
      </section>

      {categories.length > 0 ? (
        <section aria-labelledby="categories-heading" className="shell-wrap py-14 lg:py-20">
          <SectionHead id="categories-heading" title="Browse by category" />
          <ul className="grid border-b border-line md:grid-cols-2 md:gap-x-12">
            {categories.map((category, index) => (
              <li key={category.id} className="border-t border-line">
                <Link prefetch={false} href={discoverHref(null, category.id)}
                  className="group flex min-h-16 items-center justify-between gap-4 outline-offset-4">
                  <span className="flex items-baseline gap-5">
                    <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, "0")}</span>
                    <span className="display-32 underline-offset-4 group-hover:underline">{category.name}</span>
                  </span>
                  <span aria-hidden="true" className="text-xl transition-transform motion-safe:group-hover:translate-x-1">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
