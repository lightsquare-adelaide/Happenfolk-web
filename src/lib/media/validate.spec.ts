import { describe, expect, it } from "vitest";
import { sniffContentType } from "./validate";

function box(kind: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(8); header.writeUInt32BE(8 + payload.length); header.write(kind, 4);
  return Buffer.concat([header, payload]);
}

describe("MP4 structural validation", () => {
  it("rejects a truncated avc1 entry instead of reading dimensions outside it", () => {
    const count = Buffer.alloc(8); count.writeUInt32BE(1, 4);
    const sample = box("stsd", Buffer.concat([count, box("avc1")]));
    const track = box("moov", box("trak", box("mdia", box("minf", box("stbl", sample)))));
    const file = Buffer.concat([box("ftyp", Buffer.from("isom0000")), track]);
    expect(sniffContentType(file).ok).toBe(false);
  });
  it("rejects an HEVC video track even when another track is H.264", () => {
    const count = Buffer.alloc(8); count.writeUInt32BE(1, 4);
    const entry = (codec: string) => { const bytes = box(codec, Buffer.alloc(78)); bytes.writeUInt16BE(640, 32); bytes.writeUInt16BE(480, 34); return bytes; };
    const track = (codec: string) => box("trak", box("mdia", box("minf", box("stbl", box("stsd", Buffer.concat([count, entry(codec)]))))));
    const file = Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.concat([track("avc1"), track("hvc1")]))]);
    expect(sniffContentType(file).ok).toBe(false);
  });

  it("accepts an H.264 track after an audio track", () => {
    const count = Buffer.alloc(8); count.writeUInt32BE(1, 4);
    const audio = box("trak", box("mdia", box("minf", box("stbl", box("stsd", Buffer.concat([count, box("mp4a", Buffer.alloc(28))]))))));
    const videoEntry = box("avc1", Buffer.alloc(78)); videoEntry.writeUInt16BE(640, 32); videoEntry.writeUInt16BE(480, 34);
    const video = box("trak", box("mdia", box("minf", box("stbl", box("stsd", Buffer.concat([count, videoEntry]))))));
    expect(sniffContentType(Buffer.concat([box("ftyp", Buffer.from("isom0000")), box("moov", Buffer.concat([audio, video]))])).ok).toBe(true);
  });

});
