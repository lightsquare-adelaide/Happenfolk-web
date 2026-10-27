import Link from "next/link";
import { CategoryPills, ArtistTile } from "@/components/discovery/cards";
import { avatarUrl, categoryNameMap, loadCategories, type ArtistCardData } from "@/components/discovery/data";
import { EmptyState } from "@/components/empty-state";
import { secondaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { artistsHref, normalizeDiscoveryCategory, parsePage } from "@/lib/discovery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: `Artists — ${BRAND.name}`,
  description: "Every published artist and organisation on Happenfolk, filterable by category.",
};

const PAGE_SIZE = 24;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Public directory. trending_artists is the published-only view that already
// carries the work counts; ordering is overridden to A-Z for a stable index.
export default async function ArtistsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawCategory = Array.isArray(params.category) ? params.category[0] : params.category;
  const categoryId = normalizeDiscoveryCategory(rawCategory);
  const page = parsePage(params.page);
  const supabase = await createSupabaseServerClient();
  const categories = await loadCategories(supabase);
  const names = categoryNameMap(categories);
  const active = categoryId === null ? null : categories.find((c) => c.id === categoryId) ?? null;

  let query = supabase
    .from("trending_artists")
    .select("id, handle, display_name, category_id, avatar_path, published_items", { count: "exact" });
  if (active) query = query.eq("category_id", active.id);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("display_name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  const artists: ArtistCardData[] = (data ?? []).flatMap((row) =>
    row.id && row.handle ? [{
      id: row.id,
      handle: row.handle,
      displayName: row.display_name?.trim() || row.handle,
      categoryId: row.category_id,
      avatarUrl: avatarUrl(supabase, row.avatar_path),
      publishedItems: row.published_items,
      trending: false,
    }] : []);
  const total = count ?? artists.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <header className="grid gap-6 border-b border-line pb-8 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:pb-12">
        <div className="min-w-0">
          <p className="mb-4 text-sm text-muted">Artists · South Australia</p>
          <h1 className="display-64">Meet the makers.</h1>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-5 md:justify-end">
          <p className="max-w-[42ch] text-base leading-7 text-muted">
            Independent artists and organisations who have published a profile. Choose a category, or look someone up by name in Discover.
          </p>
          <Link prefetch={false} href="/discover" className={secondaryButtonClass}>Search everything</Link>
        </div>
      </header>

      <nav aria-label="Filter artists by category" className="mt-8">
        <CategoryPills categories={categories} activeId={active?.id ?? null} hrefFor={(id) => artistsHref(id)} />
      </nav>

      <section aria-labelledby="directory-heading" className="mt-10 lg:mt-12">
        <div className="mb-7 flex items-baseline justify-between gap-4">
          <h2 id="directory-heading" className="display-32 md:display-48">{active ? active.name : "All artists"}</h2>
          {!error ? (
            <p className="text-sm text-muted" aria-live="polite">{total} {total === 1 ? "artist" : "artists"}</p>
          ) : null}
        </div>
        {error ? (
          <div role="alert" className="border border-line bg-surface p-6">
            <h3 className="text-2xl">Artists could not be loaded.</h3>
            <p className="mt-2 text-sm leading-7 text-muted">Please try again in a moment.</p>
          </div>
        ) : artists.length === 0 ? (
          <EmptyState
            title={active ? `No ${active.name} artists have published yet.` : "No artists have published a profile yet."}
            hint={active ? "Try another category, or see everyone." : "Profiles appear here as soon as an artist publishes."}
            action={active ? { href: "/artists", label: "See all artists" } : { href: "/register", label: "Create account" }} />
        ) : (
          <ul className="grid min-w-0 gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {artists.map((artist, index) => (
              <li key={artist.id} className="min-w-0">
                <ArtistTile artist={artist} eager={index < 4}
                  category={artist.categoryId ? names.get(artist.categoryId) : undefined} />
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Pagination" className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-6">
            {page > 1 ? (
              <Link prefetch={false} href={artistsHref(active?.id ?? null, page - 1)} rel="prev" className={secondaryButtonClass}>Previous</Link>
            ) : <span />}
            <p className="text-sm text-muted">Page {Math.min(page, pages)} of {pages}</p>
            {page < pages ? (
              <Link prefetch={false} href={artistsHref(active?.id ?? null, page + 1)} rel="next" className={secondaryButtonClass}>Next</Link>
            ) : <span />}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
