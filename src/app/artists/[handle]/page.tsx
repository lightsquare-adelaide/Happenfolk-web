import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { publicDisplayAssets, type MediaRow } from "@/lib/portfolio";
import { PortfolioGallery } from "@/components/portfolio-gallery";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Params = { params: Promise<{ handle: string }> };
type PublicWork = Pick<Database["public"]["Tables"]["portfolio_items"]["Row"],
  "id" | "title" | "description" | "published" | "year" | "tags">;

// RLS returns a profile only when it is published or belongs to the
// caller (FR-PRO-04), so an unpublished row here means the owner is viewing.
const getProfile = cache(async (handle: string) => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, display_name, account_kind, bio, published, category_id, avatar_path")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error("Could not load this artist profile");
  if (!data) return null;
  const { data: category } = data.category_id
    ? await supabase.from("categories").select("name").eq("id", data.category_id).maybeSingle()
    : { data: null };
  return { ...data, categoryName: category?.name ?? null };
});

// RLS limits this to published items, plus the owner's drafts for the owner.
const getWorks = cache(async (profileId: string) => {
  const supabase = await createSupabaseServerClient();
  const { data: items, error: itemsError } = await supabase
    .from("portfolio_items")
    .select("id, title, description, published, year, tags")
    .eq("profile_id", profileId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<PublicWork[]>();
  if (itemsError) throw new Error("Could not load this portfolio");
  if (!items?.length) return [];
  const { data: media, error: mediaError } = await supabase
    .from("media_assets")
    .select("portfolio_item_id, path, alt_text, width, height, bucket, content_type, variant, position")
    .eq("bucket", "media")
    .in("portfolio_item_id", items.map((i) => i.id));
  if (mediaError) throw new Error("Could not load portfolio media");
  return items.map((item) => {
    const assets = item.published ? publicDisplayAssets(
      (media ?? []).filter((m) => m.portfolio_item_id === item.id) as MediaRow[],
    ) : [];
    return {
      ...item,
      media: assets.map((asset) => ({
        url: supabase.storage.from("media").getPublicUrl(asset.path).data.publicUrl,
        smallUrl: asset.smallPath ? supabase.storage.from("media").getPublicUrl(asset.smallPath).data.publicUrl : null,
        contentType: asset.content_type, altText: asset.alt_text ?? "",
        width: asset.width, height: asset.height,
      })),
    };
  });
});

export async function generateMetadata({ params }: Params) {
  const profile = await getProfile((await params).handle.toLowerCase());
  return { title: `${profile?.display_name ?? "Artist not found"} — ${BRAND.name}` };
}

export default async function ArtistPage({ params }: Params) {
  const { handle } = await params;
  if (handle !== handle.toLowerCase()) permanentRedirect("/artists/" + encodeURIComponent(handle.toLowerCase()));
  const profile = await getProfile(handle);
  if (!profile) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = user?.id === profile.id;
  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl : null;
  const works = await getWorks(profile.id);

  return (
    <main className="shell-wrap py-10 lg:py-16">
      {!profile.published ? (
        <div role="status" className="mb-8 border border-line bg-surface px-5 py-4 text-sm leading-6">
          Only you can see this profile. <Link href="/dashboard/profile" className="underline underline-offset-4">Publish it from your profile settings.</Link>
        </div>
      ) : null}
      <header className="flex min-w-0 flex-col-reverse gap-6 border-b border-line pb-8 sm:flex-row sm:items-start sm:justify-between lg:pb-12">
        <div className="min-w-0 max-w-4xl">
          <p className="mb-4 text-sm text-muted">{[
            profile.categoryName,
            profile.account_kind === "organisation" ? "Organisation" : "Independent artist",
          ].filter(Boolean).join(" · ")}</p>
          <h1 className="break-words font-display text-5xl leading-[1.05] tracking-tight md:text-[64px]">{profile.display_name}</h1>
          <p className="mt-4 break-all text-sm text-muted">{"@" + profile.handle}</p>
        </div>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public artist avatar
          <img src={avatarUrl} alt={profile.display_name + "'s avatar"} width={160} height={160} className="h-28 w-28 shrink-0 border border-line object-cover sm:h-40 sm:w-40" />
        ) : null}
      </header>
      {profile.bio ? (
        <section aria-label="About this artist" className="py-8 lg:py-10">
          <p className="max-w-[65ch] whitespace-pre-line break-words text-base leading-8">{profile.bio}</p>
        </section>
      ) : null}
      <section aria-labelledby="works-heading" className="mt-10">
        <div className="mb-7 flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="works-heading" className="font-display text-[32px] leading-tight md:text-5xl">Portfolio</h2>
          {isOwner && works.length ? <Link prefetch={false} href="/dashboard/portfolio" className="text-sm underline underline-offset-4">Manage your portfolio</Link> : null}
        </div>
        {works.length === 0 ? (
          <EmptyState title={isOwner ? "Your work starts here." : "No published work yet."}
            hint={isOwner ? "Build your portfolio in your studio. Publish each work when you are ready to share it." : "This artist has not shared any work yet."}
            action={isOwner ? { href: "/dashboard/portfolio", label: "Manage portfolio" } : undefined} />
        ) : (
          <ul className="grid min-w-0 gap-x-8 gap-y-12 sm:grid-cols-2">
            {works.map((work) => (
              <li key={work.id} className="min-w-0">
                {work.media.length ? (
                  <PortfolioGallery title={work.title} media={work.media} />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center border border-line bg-surface px-5 text-center text-sm text-muted">
                    {work.published ? "Media preview unavailable" : "Draft media is private"}
                  </div>
                )}
                <div className="mt-4 flex min-w-0 items-start justify-between gap-4">
                  <h3 className="break-words font-sans text-xl font-medium">{work.title}</h3>
                  {!work.published ? <span className="shrink-0 text-xs leading-7 text-muted">Draft · only you</span> : null}
                </div>
                {work.description ? <p className="mt-2 max-w-[60ch] whitespace-pre-line break-words text-sm leading-7 text-muted">{work.description}</p> : null}
                {work.year ? <p className="mt-2 text-sm text-muted">{work.year}</p> : null}
                {work.tags.length ? (
                  <ul aria-label={`Tags for ${work.title}`} className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
                    {work.tags.map((tag) => <li key={tag} className="break-all">{`#${tag}`}</li>)}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
