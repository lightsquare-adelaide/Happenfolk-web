import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MediaPanel, type PanelItem } from "@/components/media-panel";

export const metadata = { title: `Media management — ${BRAND.name}` };

export default async function MediaPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: works, error } = await supabase.from("portfolio_items")
    .select("id, title, media_kind, published").eq("profile_id", user.id).order("created_at");
  const ids = (works ?? []).map(row => row.id);
  const media = ids.length ? await supabase.from("media_assets")
    .select("id, portfolio_item_id, path, alt_text, content_type, width, height, position")
    .in("portfolio_item_id", ids).eq("bucket", "drafts").eq("variant", "original")
    .order("position").order("created_at") : { data: [], error: null };
  const items: PanelItem[] = (works ?? []).map(work => ({
    id: work.id, title: work.title, mediaKind: work.media_kind, published: work.published,
    assets: (media.data ?? []).filter(asset => asset.portfolio_item_id === work.id).map(asset => ({
      id: asset.id, path: asset.path, altText: asset.alt_text, contentType: asset.content_type,
      width: asset.width, height: asset.height, position: asset.position,
    })),
  }));
  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
    <header><h1 className="text-2xl font-semibold">Media management</h1>
      <Link href="/dashboard" className="text-brand-700 underline">Back to dashboard</Link></header>
    {error || media.error ? <p role="alert">Could not load your media. Please try again.</p> : <MediaPanel items={items} />}
  </main>;
}
