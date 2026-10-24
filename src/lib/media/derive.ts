import sharp from "sharp";

/**
 * Server-side image derivatives. EXIF PRIVACY BOUNDARY: sharp copies
 * NO metadata unless `.withMetadata()` is requested — master photos
 * may carry GPS coordinates and device models, and the pipeline relies
 * on that default for everything written to the public bucket. The
 * reverse-verification test in tests/media proves the guard is real:
 * adding `.withMetadata()` here must turn the suite red.
 */

/** Display sizes (CSS px width); derived variants never enlarge. */
export const VARIANT_WIDTHS = {
  small: 480,
  medium: 1080,
} as const;

export type ImageVariantName = keyof typeof VARIANT_WIDTHS;

export type DerivedImage = {
  variant: ImageVariantName;
  contentType: "image/webp";
  data: Buffer;
  width: number;
  height: number;
};

/** True pixel dimensions of an image master, post-rotation. */
export async function imageDimensions(master: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(master, { limitInputPixels: 20_000_000 }).metadata();
    if (!meta.width || !meta.height) return null;
    // Metadata can survive truncated pixel data; force complete decoding.
    await sharp(master, { limitInputPixels: 20_000_000 }).stats();
    return { width: meta.width, height: meta.height };
  } catch {
    // Magic bytes matched but the decoder cannot read the file —
    // treat as invalid (fail closed at the upload gate).
    return null;
  }
}

async function resizedWebp(master: Buffer, width: number) {
  return sharp(master, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp()
    .toBuffer({ resolveWithObject: true });
}

/**
 * Small + medium WebP derivatives of an image master. Fails when
 * sharp cannot decode the master (corrupt files never publish).
 */
export async function deriveImageVariants(master: Buffer): Promise<DerivedImage[]> {
  const derived: DerivedImage[] = [];
  for (const name of Object.keys(VARIANT_WIDTHS) as ImageVariantName[]) {
    const { data, info } = await resizedWebp(master, VARIANT_WIDTHS[name]);
    derived.push({
      variant: name,
      contentType: "image/webp",
      data,
      width: info.width,
      height: info.height,
    });
  }
  return derived;
}
