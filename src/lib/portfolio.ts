export type MediaRow = {
  path: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  bucket: string;
  content_type: string;
  variant: string;
  position: number;
};

// `drafts` is a private bucket, so its files have no public URL.
const PUBLIC_BUCKETS = ["media", "covers"];

// Publishing writes several rows per work at one position (webp sizes,
// mp4 display); a card wants the mid-size image.
const VARIANT_RANK: Record<string, number> = { medium: 0, small: 1 };
const rank = (m: MediaRow) => VARIANT_RANK[m.variant] ?? 2;

/** First publicly viewable image of a portfolio item, or null. */
export function coverAsset(media: MediaRow[]): MediaRow | null {
  return (
    media
      .filter((m) => PUBLIC_BUCKETS.includes(m.bucket) && m.content_type.startsWith("image/"))
      .sort((a, b) => a.position - b.position || rank(a) - rank(b))[0] ?? null
  );
}

export type PublicDisplayAsset = MediaRow & { smallPath: string | null };

/** One display object per published asset, including H.264 video.
 * Anonymous readers cannot read private original rows, so group only
 * public derivatives using the existing pipeline's variant path stem.
 */
export function publicDisplayAssets(media: MediaRow[]): PublicDisplayAsset[] {
  const groups = new Map<string, MediaRow[]>();
  for (const asset of media) {
    if (asset.bucket !== "media") continue;
    const image = ["image/jpeg", "image/png", "image/webp"].includes(asset.content_type)
      && ["medium", "small"].includes(asset.variant);
    const video = asset.content_type === "video/mp4" && asset.variant === "display";
    if (!image && !video) continue;
    const stem = asset.path.replace(/-(?:small|medium|display)\.[^/.]+$/, "");
    const group = groups.get(stem) ?? [];
    group.push(asset);
    groups.set(stem, group);
  }
  return [...groups.values()].map((group) => {
    const preferred = [...group].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))[0];
    return { ...preferred, smallPath: group.find((asset) => asset.variant === "small")?.path ?? null };
  }).sort((a, b) => a.position - b.position || a.path.localeCompare(b.path));
}
