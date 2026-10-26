import { describe, expect, it } from "vitest";
import { coverAsset, publicDisplayAssets, type MediaRow } from "./portfolio";

const row = (
  bucket: string,
  position: number,
  path = `${bucket}/${position}`,
  content_type = "image/webp",
  variant = "original",
): MediaRow => ({
  path,
  alt_text: "x",
  width: null,
  height: null,
  bucket,
  content_type,
  variant,
  position,
});

describe("publicDisplayAssets", () => {
  it("renders public derivatives without needing private original rows", () => {
    const media = [
      row("media", 1, "artist/image-small.webp", "image/webp", "small"),
      row("media", 0, "artist/clip-display.mp4", "video/mp4", "display"),
      row("media", 1, "artist/image-medium.webp", "image/webp", "medium"),
    ];
    expect(publicDisplayAssets(media).map((m) => m.path)).toEqual([
      "artist/clip-display.mp4", "artist/image-medium.webp",
    ]);
  });

  it("never exposes private masters, public originals or unsupported media", () => {
    expect(publicDisplayAssets([
      row("drafts", 0, "artist/private.jpg"),
      row("media", 0, "artist/original.jpg", "image/jpeg", "original"),
      row("covers", 0, "artist/cover-medium.webp", "image/webp", "medium"),
      row("media", 0, "artist/file-medium.pdf", "application/pdf", "medium"),
    ])).toEqual([]);
  });

  it("falls back to a small derivative while retaining its distinct caption", () => {
    const first = { ...row("media", 0, "artist/one-small.webp", "image/webp", "small"), alt_text: "First caption" };
    const second = { ...row("media", 1, "artist/two-medium.webp", "image/webp", "medium"), alt_text: "Second caption" };
    expect(publicDisplayAssets([second, first]).map((m) => m.alt_text)).toEqual(["First caption", "Second caption"]);
  });

  it("does not collapse different assets that have tied legacy positions", () => {
    const a = row("media", 0, "artist/a-medium.webp", "image/webp", "medium");
    const b = row("media", 0, "artist/b-medium.webp", "image/webp", "medium");
    expect(publicDisplayAssets([b, a]).map((m) => m.path)).toEqual([a.path, b.path]);
  });

  it("does not alter the supplied row order", () => {
    const media = [row("media", 2, "b-medium.webp", "image/webp", "medium"), row("media", 1, "a-medium.webp", "image/webp", "medium")];
    const order = media.map((m) => m.path);
    publicDisplayAssets(media);
    expect(media.map((m) => m.path)).toEqual(order);
  });
});

describe("coverAsset", () => {
  it("returns null when there is no media", () => {
    expect(coverAsset([])).toBeNull();
  });
  it("skips the private drafts bucket", () => {
    expect(coverAsset([row("drafts", 0)])).toBeNull();
  });
  it("picks the lowest position among public buckets", () => {
    expect(coverAsset([row("media", 2), row("drafts", 0), row("covers", 1)])?.path).toBe("covers/1");
  });
  it("skips video rows", () => {
    expect(coverAsset([row("media", 0, "v.mp4", "video/mp4", "display")])).toBeNull();
  });
  it("prefers the medium variant at the same position", () => {
    const media = [
      row("media", 0, "s.webp", "image/webp", "small"),
      row("media", 0, "m.webp", "image/webp", "medium"),
      row("media", 0, "v.mp4", "video/mp4", "display"),
    ];
    expect(coverAsset(media)?.path).toBe("m.webp");
  });
});
