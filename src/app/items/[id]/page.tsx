import Link from "next/link";
import type { Database } from "@/types/database";
import { notFound } from "next/navigation";
import { LikeButton } from "@/components/like-button";
import { PortfolioGallery } from "@/components/portfolio-gallery";
import { BRAND } from "@/lib/brand";
import { publicDisplayAssets, type MediaRow } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: `Work not found — ${BRAND.name}` };
  const supabase = await createSupabaseServerClient();
  const { data: item } = await supabase
    .from("portfolio_items")
    .select("title, profile_id, published, is_hidden")
    .eq("id", id)
    .eq("published", true)
    .eq("is_hidden", false)
    .maybeSingle();
  if (!item) return { title: `Work not found — ${BRAND.name}` };
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, published, is_hidden")
    .eq("id", item.profile_id)
    .eq("published", true)
    .eq("is_hidden", false)
    .maybeSingle();
  if (!profile) return { title: `Work not found — ${BRAND.name}` };
  return {
    title: `${item.title} — ${profile.display_name} — ${BRAND.name}`,
  };
}

/**
 * Public work detail page (/items/[id]).
 *
 * Enforces that both the portfolio item and its owning artist profile are
 * published and not hidden. Draft previews belong to the studio dashboard.
 */
export default async function ItemDetailPage({ params }: Params) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createSupabaseServerClient();
  const [
    { data: item },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("portfolio_items")
      .select(
        "id, profile_id, title, description, year, tags, media_kind, published, is_hidden, created_at",
      )
      .eq("id", id)
      .maybeSingle<Database["public"]["Tables"]["portfolio_items"]["Row"]>(),
    supabase.auth.getUser(),
  ]);

  if (!item) notFound();

  const isOwner = user?.id === item.profile_id;
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, handle, display_name, account_kind, avatar_path, bio, published, is_hidden, category_id, contact_email, open_to_collaborate",
    )
    .eq("id", item.profile_id)
    .eq("published", true)
    .eq("is_hidden", false)
    .maybeSingle();

  if (!profile) notFound();

  const isPubliclyVisible =
    item.published &&
    !item.is_hidden &&
    profile.published &&
    !profile.is_hidden;
  if (!isPubliclyVisible) notFound();

  const [
    { data: category },
    { data: rawMedia },
    { data: likeRow },
    { data: ownLike },
  ] = await Promise.all([
    profile.category_id
      ? supabase
          .from("categories")
          .select("name")
          .eq("id", profile.category_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("media_assets")
      .select(
        "portfolio_item_id, path, alt_text, width, height, bucket, content_type, variant, position",
      )
      .eq("bucket", "media")
      .eq("portfolio_item_id", item.id),
    supabase
      .from("like_counts")
      .select("like_count")
      .eq("subject_type", "portfolio_item")
      .eq("subject_id", item.id)
      .maybeSingle(),
    user
      ? supabase
          .from("interactions")
          .select("id")
          .eq("member_id", user.id)
          .eq("subject_type", "portfolio_item")
          .eq("subject_id", item.id)
          .eq("kind", "like")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const assets = item.published
    ? publicDisplayAssets((rawMedia ?? []) as MediaRow[])
    : [];
  const media = assets.map((asset) => ({
    url: supabase.storage.from("media").getPublicUrl(asset.path).data.publicUrl,
    smallUrl: asset.smallPath
      ? supabase.storage.from("media").getPublicUrl(asset.smallPath).data
          .publicUrl
      : null,
    contentType: asset.content_type,
    altText: asset.alt_text ?? "",
    width: asset.width,
    height: asset.height,
  }));

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data
        .publicUrl
    : null;
  const likeCount = Number(likeRow?.like_count ?? 0);
  const initialLiked = Boolean(ownLike);

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <Link
          href={`/artists/${encodeURIComponent(profile.handle)}`}
          className="text-sm underline underline-offset-4"
        >
          ← Back to {profile.display_name} (@{profile.handle})
        </Link>
        {isOwner && (
          <Link
            href="/dashboard/portfolio"
            className="text-sm underline underline-offset-4"
          >
            Manage in studio
          </Link>
        )}
      </div>

      <div className="grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
        <div className="min-w-0">
          {media.length > 0 ? (
            <PortfolioGallery title={item.title} media={media} />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center border border-line bg-surface px-5 text-center text-sm text-muted">
              {item.published
                ? "Media preview unavailable"
                : "Draft media is private"}
            </div>
          )}
        </div>

        <aside className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
            {[category?.name, item.year ? String(item.year) : null]
              .filter(Boolean)
              .join(" · ") || "Portfolio work"}
          </p>
          <h1 className="mt-3 break-words font-display text-4xl leading-[1.06] tracking-tight md:text-5xl">
            {item.title}
          </h1>

          {item.description && (
            <p className="mt-5 whitespace-pre-line break-words text-sm leading-7 text-muted">
              {item.description}
            </p>
          )}

          {item.tags.length > 0 && (
            <ul
              aria-label={`Tags for ${item.title}`}
              className="mt-5 flex flex-wrap gap-2 text-xs text-muted"
            >
              {item.tags.map((tag) => (
                <li
                  key={tag}
                  className="border border-line bg-surface px-2.5 py-1 font-mono"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          )}

          {isPubliclyVisible && (
            <div className="mt-6">
              <LikeButton
                subjectType="portfolio_item"
                subjectId={item.id}
                initialCount={likeCount}
                initialLiked={initialLiked}
                label="Like work"
              />
            </div>
          )}

          <section
            aria-label="Artist"
            className="mt-8 border-t border-line pt-6"
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">
              Practitioner
            </p>
            <Link
              href={`/artists/${encodeURIComponent(profile.handle)}`}
              className="mt-3 flex items-center gap-3.5 border border-line bg-surface p-4 transition-colors hover:border-foreground"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- public artist avatar
                <img
                  src={avatarUrl}
                  alt={`${profile.display_name}'s avatar`}
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-tint font-display text-lg"
                >
                  {profile.display_name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {profile.display_name}
                </p>
                <p className="truncate font-mono text-xs text-muted">
                  @{profile.handle}
                </p>
              </div>
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
