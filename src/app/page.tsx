import Link from "next/link";
import { DateBlock, EventFeedCard } from "@/components/event-card";
import { formatEventDate } from "@/lib/dashboard";
import { getCategories, getEvents, getMyLikes, getRecentWorks, getTrendingArtists, type WorkCard } from "@/lib/showcase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ago = new Intl.RelativeTimeFormat("en-AU", { numeric: "auto" });
function since(iso: string | null) {
  if (!iso) return "";
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return hours < 24 ? ago.format(-hours, "hour") : ago.format(-Math.round(hours / 24), "day");
}

function WorkPost({ work }: { work: WorkCard }) {
  return (
    <article className="post">
      <div className="post-head">
        {work.artist?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
          <img className="avatar" src={work.artist.avatarUrl} width={44} height={44} alt="" />
        ) : null}
        <div>
          {work.artist ? <Link href={`/artists/${work.artist.handle}`}>{work.artist.display_name}</Link> : null}
          <div className="muted">Added a new work, {since(work.published_at)}</div>
        </div>
      </div>
      <p>
        <b>{work.title}.</b> {work.description}
      </p>
      {work.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
        <img src={work.imageUrl} width={work.width ?? undefined} height={work.height ?? undefined} alt={work.alt} loading="lazy" />
      ) : null}
    </article>
  );
}

export default async function Home() {
  const db = await createSupabaseServerClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const [categories, events, works, trending] = await Promise.all([
    getCategories(db),
    getEvents(db, { limit: 6 }),
    getRecentWorks(db, { limit: 8 }),
    getTrendingArtists(db, 6),
  ]);
  const liked = await getMyLikes(db, "event", events.map((e) => e.id));
  const featured = works[0];

  // ponytail: simple alternation stands in for the ranked feed (FR-FEED / AI ranking, later).
  const feed: ({ kind: "event"; item: (typeof events)[number] } | { kind: "work"; item: WorkCard })[] = [];
  for (let i = 0; i < Math.max(events.length, works.length); i++) {
    if (events[i]) feed.push({ kind: "event", item: events[i] });
    if (works[i + 1]) feed.push({ kind: "work", item: works[i + 1] });
  }

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div>
            <h1 className="display d64">See what your local creatives are doing</h1>
            <div className="ctas">
              {user ? (
                <Link className="btn btn-primary" href="/dashboard">
                  Go to your dashboard
                </Link>
              ) : (
                <Link className="btn btn-primary" href="/register">
                  Create account
                </Link>
              )}
              <Link className="btn btn-ghost" href="/events">
                Browse events
              </Link>
            </div>
          </div>
          {featured?.imageUrl ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
              <img src={featured.imageUrl} width={960} height={1200} alt={featured.alt} fetchPriority="high" />
              <figcaption className="t14 muted">
                {featured.artist ? <Link href={`/artists/${featured.artist.handle}`}>{featured.artist.display_name}</Link> : null},{" "}
                {featured.title}.
              </figcaption>
            </figure>
          ) : null}
        </div>
      </section>

      {trending.length ? (
        <section className="trending" aria-labelledby="trending-title">
          <div className="wrap">
            <div className="section-head">
              <h2 id="trending-title" className="display d48">
                Trending this week
              </h2>
              <Link href="/artists">All artists</Link>
            </div>
            <ol className="strip">
              {trending.map((a, i) => (
                <li key={a.id}>
                  <article>
                    {a.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                      <img src={a.coverUrl} width={600} height={600} alt={`Work by ${a.display_name}`} loading="lazy" />
                    ) : null}
                    <div className="who">
                      <span className={`rank${i === 0 ? " top" : ""}`}>
                        <span className="sr-only">Rank </span>
                        <span>{i + 1}</span>
                      </span>
                      <div>
                        <Link href={`/artists/${a.handle}`}>{a.display_name}</Link>
                        <div className="t14 muted">{categories.find((c) => c.id === a.category_id)?.name}</div>
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>
      ) : null}

      <div className="wrap feed-layout">
        <section className="feed" aria-labelledby="feed-title">
          <h2 id="feed-title" className="display d48 feed-title">
            Newsfeed
          </h2>
          {feed.length === 0 ? <p className="empty">Nothing here yet.</p> : null}
          {feed.map((f) =>
            f.kind === "event" ? (
              <EventFeedCard key={f.item.id} event={f.item} categories={categories} liked={liked.has(f.item.id)} />
            ) : (
              <WorkPost key={f.item.id} work={f.item} />
            ),
          )}
        </section>

        <aside className="aside">
          <section>
            <h2>Browse by category</h2>
            <div className="chips">
              {categories.map((c) => (
                <Link key={c.id} href={`/artists?category=${c.slug}`}>
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
          {events.length ? (
            <section className="soon">
              <h2>Coming up</h2>
              <ul>
                {events.slice(0, 3).map((e) => (
                  <li key={e.id}>
                    <DateBlock iso={e.starts_at} />
                    <div>
                      <Link href={`/events/${e.id}`}>{e.title}</Link>
                      <div className="t14 muted">{formatEventDate(e.starts_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {user ? null : (
            <section className="join">
              <p>Show your work and find people to make things with.</p>
              <div className="btns">
                <Link className="btn btn-primary" href="/register">
                  Create account
                </Link>
                <Link className="btn btn-ghost" href="/login">
                  Sign in
                </Link>
              </div>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
