/**
 * Curated artwork for the shell (auth aside, quiet editorial placements).
 *
 * Provenance: these three files were preserved from the project's existing
 * local source cache before the database reset, and each one was visually
 * inspected by the lead on 2026-10-26. Licences and attribution come from the
 * preserved source manifest; the external Art Institute of Chicago endpoint
 * returned HTTP 403 that day, so no fresh revalidation was possible and none
 * is claimed. The full record lives in docs/design/artwork-sources.json.
 *
 * Alt text describes what is actually in the file (per the lead's artwork
 * review), never the old manifest title used as a description. These are
 * historical works by named artists: they are credited as such and must not be
 * presented as work by a Happenfolk member.
 */

export type CuratedArtwork = {
  /** File name under public/artwork/. */
  file: string;
  /** Objective description of the pixels, used as the alt attribute. */
  alt: string;
  title: string;
  creator: string;
  year: string;
  license: string;
  source: string;
  sourceUrl: string;
  width: number;
  height: number;
};

export const CURATED_ARTWORK: readonly CuratedArtwork[] = [
  {
    file: "aic-87045.jpg",
    alt: "A painted still life of a flowering geranium in a terracotta pot beside patterned vessels.",
    title: "Still Life with Geranium",
    creator: "Henri Matisse",
    year: "1906",
    license: "CC0 1.0",
    source: "Art Institute of Chicago",
    sourceUrl: "https://www.artic.edu/artworks/87045",
    width: 600,
    height: 746,
  },
  {
    file: "aic-109819.jpg",
    alt: "A diamond-shaped painting with black lines dividing white, yellow and blue geometric areas.",
    title: "Lozenge Composition with Yellow, Black, Blue, Red, and Gray",
    creator: "Piet Mondrian",
    year: "1921",
    license: "CC0 1.0",
    source: "Art Institute of Chicago",
    sourceUrl: "https://www.artic.edu/artworks/109819",
    width: 600,
    height: 600,
  },
  {
    file: "aic-65916.jpg",
    alt: "An abstract painting with angular black forms, a red oval and yellow, green and blue shapes.",
    title: "Movement",
    creator: "Marsden Hartley",
    year: "1913",
    license: "CC0 1.0",
    source: "Art Institute of Chicago",
    sourceUrl: "https://www.artic.edu/artworks/65916",
    width: 600,
    height: 604,
  },
] as const;

/** Public path of a curated file. */
export function artworkSrc(artwork: CuratedArtwork): string {
  return `/artwork/${artwork.file}`;
}

/**
 * Deterministic pick, stable per key: the same page always shows the same
 * work, and different auth pages show different works without any state.
 */
export function pickArtwork(seedKey: string): CuratedArtwork {
  let hash = 0;
  for (const character of seedKey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CURATED_ARTWORK[hash % CURATED_ARTWORK.length];
}

/** One honest credit line: title, artist, year, institution, licence. */
export function attributionLine(artwork: CuratedArtwork): string {
  return `${artwork.title}, ${artwork.creator}, ${artwork.year}. ${artwork.source}. ${artwork.license}.`;
}
