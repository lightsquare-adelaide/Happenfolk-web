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
