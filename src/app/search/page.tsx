import Link from "next/link";
import { DateBlock } from "@/components/event-card";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: `Search — ${BRAND.name}` };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

// ponytail: substring match on names/titles; swap for the search_vector columns (FR-DIS search) later.
export default async function SearchPage({ searchParams }: Props) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const db = await createSupabaseServerClient();
  // Escape LIKE wildcards and PostgREST's or() separators in user input.
  const term = `%${q.replace(/[%_\\]/g, "\\$&").replace(/[,()"]/g, " ")}%`;
  const [{ data: artists }, { data: events }] = q
    ? await Promise.all([
        db.from("profiles").select("handle, display_name").eq("published", true).or(`display_name.ilike.${term},handle.ilike.${term}`).limit(20),
        db.from("events").select("id, title, starts_at").eq("status", "published").ilike("title", term).order("starts_at").limit(20),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <main className="wrap">
      <header className="page-head">
        <h1 className="display d48">{q ? `Results for “${q}”` : "Search"}</h1>
        <p className="muted">Searches artist names and event titles in this preview.</p>
      </header>
      {q && !artists?.length && !events?.length ? <p className="empty">Nothing matched. Try another name or title.</p> : null}
      {artists?.length ? (
        <section style={{ marginBottom: 48 }}>
          <h2 className="display d32" style={{ marginBottom: 16 }}>
            Artists
          </h2>
          <ul className="ev-list">
            {artists.map((a) => (
              <li key={a.handle}>
                <div className="grow">
                  <Link href={`/artists/${a.handle}`}>{a.display_name}</Link>
                  <div className="t14 muted">@{a.handle}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {events?.length ? (
        <section>
          <h2 className="display d32" style={{ marginBottom: 16 }}>
            Events
          </h2>
          <ul className="ev-list">
            {events.map((e) => (
              <li key={e.id}>
                <DateBlock iso={e.starts_at} />
                <div className="grow">
                  <Link href={`/events/${e.id}`}>{e.title}</Link>
                  <div className="t14 muted">{formatEventDate(e.starts_at)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
