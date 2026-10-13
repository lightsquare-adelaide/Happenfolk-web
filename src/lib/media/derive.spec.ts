import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { imageDimensions } from "./derive";

describe("complete image decoding", () => {
  it("rejects truncated pixel data even when JPEG dimensions can be read", async () => {
    const jpeg = await sharp(randomBytes(320 * 240 * 3), {raw: {width: 320, height: 240, channels: 3}}).jpeg().toBuffer();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));
    expect((await sharp(truncated).metadata()).width).toBe(320);
    expect(await imageDimensions(truncated)).toBeNull();
  });
});
