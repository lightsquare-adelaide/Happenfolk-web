import { describe, expect, it } from "vitest";
import { coverAsset, type MediaRow } from "./portfolio";

const row = (bucket: string, position: number, path = `${bucket}/${position}`): MediaRow => ({
  path,
  alt_text: "x",
  width: null,
  height: null,
  bucket,
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
});
