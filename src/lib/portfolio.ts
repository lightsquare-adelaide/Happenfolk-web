export type MediaRow = {
  path: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  bucket: string;
  position: number;
};

// `drafts` is a private bucket, so its files have no public URL.
const PUBLIC_BUCKETS = ["media", "covers"];

/** First publicly viewable image of a portfolio item, or null. */
export function coverAsset(media: MediaRow[]): MediaRow | null {
  return (
    media
      .filter((m) => PUBLIC_BUCKETS.includes(m.bucket))
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}
