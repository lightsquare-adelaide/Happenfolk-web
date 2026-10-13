import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ArtistMedia } from "@/components/artist-media";
import { BRAND } from "@/lib/brand";
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
  const avatarUrl = profile.avatar_path ? (await createSupabaseServerClient()).storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      {profile.published ? null : (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
          Only you can see this page. Publish your profile to make it public.
        </p>
      )}

      <header className="flex flex-col gap-1">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={`${profile.display_name}'s avatar`} width={256} height={256} className="rounded-full" />
        ) : null}
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

      <ArtistMedia profileId={profile.id} />
      {profile.bio ? <p className="max-w-2xl whitespace-pre-line">{profile.bio}</p> : null}
    </main>
  );
}
