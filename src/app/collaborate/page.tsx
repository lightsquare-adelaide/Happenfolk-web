import Link from "next/link";
import {
  CollaborateGrid,
  type CollaborateProfile,
} from "@/components/collaborate-grid";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Collaborate — ${BRAND.name}`,
  description:
    "Directory of published Happenfolk practitioners and cultural organisations open to creative collaboration, commissions and joint projects.",
};

type SearchParams = Promise<{ category?: string }>;

/**
 * Public collaboration directory (/collaborate).
 *
 * Lists published, non-hidden profiles that have opted into
 * `open_to_collaborate = true`, filterable by creative category.
 */
export default async function CollaboratePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { category: rawCategory } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: categoriesData }, { data: profilesData }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, slug, name, sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("profiles")
      .select(
        "id, handle, display_name, account_kind, bio, contact_email, category_id, avatar_path",
      )
      .eq("published", true)
      .eq("is_hidden", false)
      .eq("open_to_collaborate", true)
      .order("display_name", { ascending: true }),
  ]);

  const categories = categoriesData ?? [];
  const categoryNameById = new Map<number, string>();
  for (const c of categories) categoryNameById.set(c.id, c.name);

  let initialCategoryId: number | null = null;
  if (rawCategory) {
    const asNumber = Number(rawCategory);
    if (Number.isInteger(asNumber) && categoryNameById.has(asNumber)) {
      initialCategoryId = asNumber;
    } else {
      const bySlug = categories.find((c) => c.slug === rawCategory);
      if (bySlug) initialCategoryId = bySlug.id;
    }
  }

  const profiles: CollaborateProfile[] = (profilesData ?? []).map((p) => ({
    id: p.id,
    handle: p.handle,
    display_name: p.display_name,
    account_kind: p.account_kind,
    bio: p.bio,
    contact_email: p.contact_email,
    category_id: p.category_id,
    categoryName:
      p.category_id !== null
        ? (categoryNameById.get(p.category_id) ?? null)
        : null,
    avatarUrl: p.avatar_path
      ? supabase.storage.from("avatars").getPublicUrl(p.avatar_path).data
          .publicUrl
      : null,
  }));

  return (
    <main className="shell-wrap py-12 lg:py-20">
      <header className="mb-12 border-b border-line pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
            Practitioner Directory · Open to Collaborate
          </p>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {profiles.length} {profiles.length === 1 ? "artist" : "artists"}{" "}
            available
          </p>
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <h1 className="font-display text-5xl leading-[1.04] tracking-tight md:text-[64px]">
              Find a collaborator for your next exhibition, score or commission.
            </h1>
          </div>
          <div className="space-y-4 lg:col-span-4">
            <p className="text-sm leading-6 text-muted">
              Every practitioner listed here has opted in to collaboration
              enquiries from their studio profile. Filter by discipline or reach
              out directly via their public studio contact.
            </p>
            <Link
              href="/dashboard/profile"
              className="inline-block font-mono text-xs uppercase tracking-[0.16em] text-foreground underline underline-offset-4"
            >
              Opt in from your studio profile →
            </Link>
          </div>
        </div>
      </header>

      <CollaborateGrid
        profiles={profiles}
        categories={categories}
        initialCategoryId={initialCategoryId}
      />
    </main>
  );
}
