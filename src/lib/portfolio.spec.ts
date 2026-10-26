import { describe, expect, it } from "vitest";
import { coverAsset, type MediaRow } from "./portfolio";

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
