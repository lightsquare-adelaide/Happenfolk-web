import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { coverAsset, type MediaRow } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ handle: string }> };

// RLS returns a profile only when it is published or belongs to the
// caller (FR-PRO-04), so an unpublished row here means the owner is viewing.
const getProfile = cache(async (handle: string) => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, handle, display_name, account_kind, bio, published, category_id")
    .eq("handle", handle)
    .maybeSingle();
  if (!data) return null;
  const { data: category } = data.category_id
    ? await supabase.from("categories").select("name").eq("id", data.category_id).maybeSingle()
    : { data: null };
  return { ...data, categoryName: category?.name ?? null };
});

// RLS limits this to published items, plus the owner's drafts for the owner.
const getWorks = cache(async (profileId: string) => {
  const supabase = await createSupabaseServerClient();
  const { data: items } = await supabase
    .from("portfolio_items")
    .select("id, title, description, published")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (!items?.length) return [];
  const { data: media } = await supabase
    .from("media_assets")
    .select("portfolio_item_id, path, alt_text, width, height, bucket, content_type, variant, position")
    .in("portfolio_item_id", items.map((i) => i.id));
  return items.map((item) => {
    const cover = coverAsset(
      (media ?? []).filter((m) => m.portfolio_item_id === item.id) as MediaRow[],
    );
    return {
      ...item,
      cover: cover && {
        ...cover,
        url: supabase.storage.from(cover.bucket).getPublicUrl(cover.path).data.publicUrl,
      },
    };
  });
});

export async function generateMetadata({ params }: Params) {
  const profile = await getProfile((await params).handle.toLowerCase());
  return { title: `${profile?.display_name ?? "Artist not found"} — ${BRAND.name}` };
}

export default async function ArtistPage({ params }: Params) {
  const { handle } = await params;
  // Handles are stored lowercase, so /artists/Ada resolves to /artists/ada.
  if (handle !== handle.toLowerCase()) {
    permanentRedirect(`/artists/${encodeURIComponent(handle.toLowerCase())}`);
  }
  const profile = await getProfile(handle);
  if (!profile) notFound();
  const works = await getWorks(profile.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      {profile.published ? null : (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
          Only you can see this page. Publish your profile to make it public.
        </p>
      )}

      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{profile.display_name}</h1>
        <p className="font-mono text-sm text-muted">@{profile.handle}</p>
        <p className="text-sm text-muted">
          {[
            profile.categoryName,
            profile.account_kind === "organisation" ? "Organisation" : "Individual",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {profile.bio ? <p className="max-w-2xl whitespace-pre-line">{profile.bio}</p> : null}

      <section aria-labelledby="works-heading" className="flex flex-col gap-3">
        <h2 id="works-heading" className="text-xl font-semibold">
          Portfolio
        </h2>
        {works.length === 0 ? (
          <p className="text-sm text-muted">No works to show yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {works.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                {w.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL; no image loader configured
                  <img
                    src={w.cover.url}
                    alt={w.cover.alt_text ?? ""}
                    width={w.cover.width ?? undefined}
                    height={w.cover.height ?? undefined}
                    loading="lazy"
                    className="h-auto w-full rounded"
                  />
                ) : null}
                <h3 className="font-medium">{w.title}</h3>
                {w.published ? null : <p className="text-xs text-muted">Draft — only you can see this.</p>}
                {w.description ? <p className="text-sm text-muted">{w.description}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
