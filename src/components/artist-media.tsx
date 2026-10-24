import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function ArtistMedia({ profileId }: { profileId: string }) {
  const supabase = await createSupabaseServerClient();
  // Filter both publication and public bucket: original paths are never displayed.
  const { data: works } = await supabase.from("portfolio_items")
    .select("id, title").eq("profile_id", profileId).eq("published", true).order("created_at");
  if (!works?.length) return null;
  const { data: assets } = await supabase.from("media_assets")
    .select("id, portfolio_item_id, path, alt_text, content_type, variant, width, height")
    .in("portfolio_item_id", works.map(work => work.id)).eq("bucket", "media")
    .in("variant", ["medium", "display"]).order("position");
  return <section aria-label="Published works" className="flex flex-col gap-4">
    <h2 className="text-xl font-semibold">Published works</h2>
    {works.map(work => <article key={work.id}><h3 className="font-medium">{work.title}</h3>
      {(assets ?? []).filter(asset => asset.portfolio_item_id === work.id).map(asset => {
        const url = supabase.storage.from("media").getPublicUrl(asset.path).data.publicUrl;
        return asset.content_type === "video/mp4"
          ? <figure key={asset.id}><video src={url} controls preload="metadata" className="max-w-full" aria-label={asset.alt_text ?? work.title} /><figcaption>{asset.alt_text}</figcaption></figure>
          // Stored URLs are rendered directly; dimensions avoid layout shift.
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={asset.id} src={url} alt={asset.alt_text ?? ""} width={asset.width ?? undefined} height={asset.height ?? undefined} loading="lazy" className="max-w-full" />;
      })}</article>)}
  </section>;
}
