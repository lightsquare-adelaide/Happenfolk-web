import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { DateBlock } from "@/components/event-card";
import { BRAND } from "@/lib/brand";
import { formatEventDate } from "@/lib/dashboard";
import { getEvents, priceLabel } from "@/lib/showcase";
import { coverAsset, type MediaRow } from "@/lib/portfolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ handle: string }> };

// RLS returns a profile only when it is published or belongs to the
// caller (FR-PRO-04), so an unpublished row here means the owner is viewing.
const getProfile = cache(async (handle: string) => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, handle, display_name, account_kind, bio, published, category_id, avatar_path")
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
  const db = await createSupabaseServerClient();
  const [works, events] = await Promise.all([getWorks(profile.id), getEvents(db, { hostId: profile.id })]);
  const avatarUrl = profile.avatar_path ? db.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl : null;
  // Varied tile sizes as in the portfolio mockup; repeats every six works.
  const tile = ["big", "", "tall", "", "wide", ""];

  return (
    <main>
      {profile.published ? null : (
        <p className="wrap" style={{ paddingTop: 16 }}>
          <span className="soon-tag">Only you can see this page. Publish your profile to make it public.</span>
        </p>
      )}

      <section className="profile">
        <div className="wrap">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
            <img className="avatar" src={avatarUrl} alt="" width={128} height={128} />
          ) : (
            <span />
          )}
          <div>
            <h1 className="display d48">{profile.display_name}</h1>
            <div className="meta">
              <span className="font-mono">@{profile.handle}</span>
              {profile.categoryName ? <span>{profile.categoryName}</span> : null}
              <span>{profile.account_kind === "organisation" ? "Organisation" : "Individual artist"}</span>
            </div>
            {profile.bio ? <p className="bio whitespace-pre-line">{profile.bio}</p> : null}
          </div>
          <div className="profile-actions">
            <span className="btn btn-ghost" aria-disabled="true" title="Not live in this preview">
              Follow
            </span>
            <span className="btn btn-primary" aria-disabled="true" title="Not live in this preview">
              Invite to collaborate
            </span>
          </div>
        </div>
      </section>

      <nav className="tabs" aria-label="Profile sections">
        <div className="wrap">
          <a href="#works" aria-current="page">
            Portfolio<span className="count">{works.length}</span>
          </a>
          <a href="#events">
            Events<span className="count">{events.length}</span>
          </a>
        </div>
      </nav>

      <div className="wrap">
        <section id="works" aria-label="Portfolio">
          {works.length === 0 ? (
            <p className="empty">No works to show yet.</p>
          ) : (
            <div className="works">
              {works.map((w, i) => (
                <figure key={w.id} className={tile[i % tile.length]}>
                  {w.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL; no image loader configured
                    <img
                      src={w.cover.url}
                      alt={w.cover.alt_text ?? ""}
                      width={w.cover.width ?? undefined}
                      height={w.cover.height ?? undefined}
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ background: "var(--surface)" }} />
                  )}
                  <figcaption>
                    <b>{w.title}</b>
                    {w.published ? null : <span className="muted"> · Draft, only you can see this</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>

        <section id="events" className="artist-events">
          <div>
            <h2 className="display d48">Upcoming events</h2>
          </div>
          {events.length === 0 ? (
            <p className="empty">No upcoming events.</p>
          ) : (
            <ul className="ev-list">
              {events.map((e) => (
                <li key={e.id}>
                  <DateBlock iso={e.starts_at} />
                  <div className="grow">
                    <Link href={`/events/${e.id}`}>{e.title}</Link>
                    <div className="t14 muted">
                      {formatEventDate(e.starts_at)} · {priceLabel(e.price_cents)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
