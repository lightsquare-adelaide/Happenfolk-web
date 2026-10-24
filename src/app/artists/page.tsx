import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getCategories, getPeople, getRecentWorks } from "@/lib/showcase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: `Artists — ${BRAND.name}` };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ category?: string }> };

export default async function ArtistsPage({ searchParams }: Props) {
  const { category: slug } = await searchParams;
  const db = await createSupabaseServerClient();
  const categories = await getCategories(db);
  const category = categories.find((c) => c.slug === slug);

  // RLS: only published profiles, plus the viewer's own.
  let q = db.from("profiles").select("id").eq("published", true).order("display_name").limit(60);
  if (category) q = q.eq("category_id", category.id);
  const { data } = await q;
  const ids = (data ?? []).map((r) => r.id);
  const [people, works] = await Promise.all([getPeople(db, ids), getRecentWorks(db, { limit: 200, profileIds: ids })]);

  return (
    <main className="wrap">
      <header className="page-head">
        <h1 className="display d64">{category ? category.name : "Artists"}</h1>
        <p className="t20 muted">Independent artists and organisations in South Australia.</p>
      </header>
      <nav className="chips" aria-label="Categories" style={{ marginBottom: 40 }}>
        <Link href="/artists" aria-current={category ? undefined : "true"}>
          All
        </Link>
        {categories.map((c) => (
          <Link key={c.id} href={`/artists?category=${c.slug}`} aria-current={c.id === category?.id ? "true" : undefined}>
            {c.name}
          </Link>
        ))}
      </nav>
      {ids.length === 0 ? (
        <p className="empty">No artists in this category yet.</p>
      ) : (
        <ul className="grid-artists">
          {ids.map((id) => {
            const p = people.get(id);
            if (!p) return null;
            const cover = works.find((w) => w.artist?.id === id);
            return (
              <li key={id}>
                <Link href={`/artists/${p.handle}`}>
                  {cover?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                    <img className="cover" src={cover.imageUrl} width={600} height={600} alt="" loading="lazy" />
                  ) : null}
                </Link>
                <div className="who">
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                    <img className="avatar" src={p.avatarUrl} width={40} height={40} alt="" />
                  ) : null}
                  <div>
                    <Link href={`/artists/${p.handle}`}>{p.display_name}</Link>
                    <div className="t14 muted">{categories.find((c) => c.id === p.category_id)?.name}</div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
