/**
 * Media upload validation — pure functions over raw bytes.
 *
 * SECURITY BOUNDARY. Two rules the whole module enforces:
 *
 * 1. Never trust the client. The file extension and the browser's
 *    Content-Type header are attacker-controlled hints; the only
 *    acceptable evidence is the byte content itself (magic numbers,
 *    and for MP4 the actual codec boxes in the file).
 * 2. Whitelist direction. A file is accepted only when its bytes
 *    PROVE it is one of the four allowed types. Ambiguity, truncation
 *    or parse anomalies are rejections — never "probably fine".
 *
 * The MP4 check parses the ISO-BMFF box tree for the H.264 sample
 * entry (`avc1`/`avc3`). The `moov` box routinely sits at the END of
 * the file (both ffmpeg defaults and iPhone recordings), so a
 * front-bytes-only check silently passes HEVC; the walker below
 * follows box sizes wherever they point.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MiB, below the Vercel multipart payload limit

/** The complete set of content types this pipeline accepts. */
export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export type Sniffed =
  | {
      ok: true;
      contentType: AllowedContentType;
      ext: string;
      width: number | null;
      height: number | null;
    }
  | { ok: false; problem: string; hint?: string };

/** User-facing export guidance for HEVC sources (the iPhone default). */
export const HEVC_HINT =
  "The video is HEVC/H.265 (the iPhone 'High Efficiency' default format); this codec is not supported by most browsers directly." +
  "Switch to H.264: on iPhone, set Settings -> Camera -> Formats to 'Most Compatible' and record again, " +
  "or export with QuickTime/ffmpeg, e.g. ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p output.mp4";

function startsWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

function asciiAt(bytes: Uint8Array, offset: number, count: number): string {
  let out = "";
  for (let i = 0; i < count; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/** Sample-entry fourCCs that describe audio tracks (ignored, not video). */
const AUDIO_SAMPLE_ENTRIES: Record<string, true> = {
  mp4a: true,
  Opus: true,
  opus: true,
  "ac-3": true,
  "ec-3": true,
  samr: true,
  sawb: true,
  sawp: true,
  alac: true,
  fLaC: true,
  lpcm: true,
  sowt: true,
  twos: true,
};

/** moov-descended containers the stsd search may descend into. */
const STSD_SEARCH_CONTAINERS: Record<string, true> = {
  moov: true,
  trak: true,
  mdia: true,
  minf: true,
  stbl: true,
};

type VideoTrack = { codec: string; width: number; height: number };

/**
 * Walks ISO-BMFF boxes in [start, end) and calls visit for each box.
 * Bounded: box sizes that run past `end`, zero-size boxes that do not
 * point at EOF, or pathological counts abort the walk (fail closed).
 * Returns false when the tree is malformed.
 */
function walkBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => void,
): boolean {
  let offset = start;
  let boxes = 0;
  const maxBoxes = 4096;
  while (offset < end) {
    if (end - offset < 8) return false;
    boxes += 1;
    if (boxes > maxBoxes) return false;
    let size = u32be(bytes, offset);
    const type = asciiAt(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize follows the type.
      if (end - offset < 16) return false;
      const hi = u32be(bytes, offset + 8);
      const lo = u32be(bytes, offset + 12);
      size = hi * 2 ** 32 + lo;
      header = 16;
    } else if (size === 0) {
      // Extends to the end of the enclosing container.
      size = end - offset;
    }
    if (size < header) return false;
    const boxEnd = offset + size;
    if (boxEnd > end) return false;
    visit(type, offset + header, boxEnd);
    offset = boxEnd;
  }
  return true;
}

/**
 * Extracts video sample entries from an `stsd` box payload.
 * stsd payload: 1 byte version + 3 flags + entry_count, then entries.
 * VisualSampleEntry layout from the entry start: size(4) fourCC(4)
 * reserved(6) data_ref_index(2) pre_defined(2) reserved(2)
 * pre_defined(12) width(2) height(2) — dimensions at +32/+34.
 */
function readVideoEntries(bytes: Uint8Array, stsdStart: number, stsdEnd: number): VideoTrack[] | null {
  if (stsdEnd - stsdStart < 8) return null;
  const entryCount = u32be(bytes, stsdStart + 4);
  let offset = stsdStart + 8;
  const tracks: VideoTrack[] = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (stsdEnd - offset < 8) return null;
    const size = u32be(bytes, offset);
    if (size < 8 || offset + size > stsdEnd) return null;
    const fourCC = asciiAt(bytes, offset + 4, 4);
    if (!AUDIO_SAMPLE_ENTRIES[fourCC]) {
      if (size < 86) return null;
      tracks.push({
        codec: fourCC,
        width: u16be(bytes, offset + 32),
        height: u16be(bytes, offset + 34),
      });
    }
    offset += size;
  }
  return offset === stsdEnd ? tracks : null;
}

/** Collect every track's sample description; reject malformed/deep trees. */
function findStsds(bytes: Uint8Array, start: number, end: number, depth = 0): {start: number; end: number}[] | null {
  if (depth > 16) return null;
  const result: {start: number; end: number}[] = [];
  let malformed = false;
  const ok = walkBoxes(bytes, start, end, (type, payloadStart, payloadEnd) => {
    if (type === "stsd") result.push({start: payloadStart, end: payloadEnd});
    else if (STSD_SEARCH_CONTAINERS[type]) {
      const nested = findStsds(bytes, payloadStart, payloadEnd, depth + 1);
      if (nested === null) malformed = true; else result.push(...nested);
    }
  });
  return ok && !malformed ? result : null;
}

/**
 * Accepts only ISO-BMFF files whose tracks PROVE H.264 video
 * (`avc1`/`avc3` sample entry). Anything else — HEVC (`hvc1`/`hev1`),
 * unknown codecs, malformed box trees, missing `moov` — is rejected.
 * Whitelist direction: absence of confirmable H.264 means rejection.
 */
function sniffMp4(bytes: Uint8Array): Sniffed {
  // ISO-BMFF files start with a box; a family file has `ftyp` first in
  // practice, but the contract that matters is the box tree itself.
  if (asciiAt(bytes, 4, 4) !== "ftyp") {
    return { ok: false, problem: "Not a supported MP4 file (missing ftyp header)" };
  }
  const topLevel: { type: string; start: number; end: number }[] = [];
  const ok = walkBoxes(bytes, 0, bytes.length, (type, payloadStart, payloadEnd) => {
    topLevel.push({ type, start: payloadStart, end: payloadEnd });
  });
  if (!ok) return { ok: false, problem: "MP4 file structure is corrupt (box out of bounds)" };
  const moov = topLevel.find((b) => b.type === "moov");
  if (!moov) return { ok: false, problem: "Not a browser-playable MP4 (missing moov track index)" };

  const descriptions = findStsds(bytes, moov.start, moov.end);
  if (!descriptions?.length) return { ok: false, problem: "Not a browser-playable MP4 (missing or corrupt sample description)" };
  const tracks: VideoTrack[] = [];
  for (const description of descriptions) {
    const entries = readVideoEntries(bytes, description.start, description.end);
    if (!entries) return { ok: false, problem: "MP4 sample description is corrupt" };
    tracks.push(...entries);
  }

  const h264 = tracks.find((t) => t.codec === "avc1" || t.codec === "avc3");
  if (!h264 || tracks.some(track => track.codec !== "avc1" && track.codec !== "avc3")) {
    const codecs = tracks.map((t) => t.codec).join(", ");
    const hevc = tracks.some((t) => t.codec === "hvc1" || t.codec === "hev1");
    return {
      ok: false,
      problem: hevc
        ? `Video is HEVC (${codecs}); not supported`
        : `Video codec is not H.264 (${codecs || "no video track"}); not supported`,
      hint: HEVC_HINT,
    };
  }
  return {
    ok: true,
    contentType: "video/mp4",
    ext: "mp4",
    width: h264.width > 0 ? h264.width : null,
    height: h264.height > 0 ? h264.height : null,
  };
}

/**
 * Sniffs the REAL content type from raw bytes. Accepts only the four
 * whitelisted types; every other byte pattern (including renamed
 * binaries) is rejected with a user-facing problem.
 */
export function sniffContentType(bytes: Uint8Array): Sniffed {
  if (bytes.length <= 0 || bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      problem: `File exceeds the 4 MiB limit (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`,
    };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: "image/jpeg", ext: "jpg", width: null, height: null };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: "image/png", ext: "png", width: null, height: null };
  }
  if (bytes.length > 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    return { ok: true, contentType: "image/webp", ext: "webp", width: null, height: null };
  }
  return sniffMp4(bytes);
}

/**
 * Storage object path: `{uid}/{uuid}.{ext}`. The user's original file
 * name NEVER reaches storage — it is untrusted input and leaks nothing
 * anyway; the uid prefix is what the 0007 storage policies pin to.
 */
export function safeObjectPath(uid: string, ext: string): string {
  return `${uid}/${crypto.randomUUID()}.${ext}`;
}

export function variantObjectPath(masterPath: string, variant: string, ext = "webp"): string {
  const slash = masterPath.lastIndexOf("/");
  const dot = masterPath.lastIndexOf(".");
  const stem = dot > slash ? masterPath.slice(0, dot) : masterPath;
  return `${stem}-${variant}.${ext}`;
}
export type ValidatedUpload = {
  contentType: AllowedContentType;
  ext: string;
  width: number | null;
  height: number | null;
};

/**
 * Full server-side upload gate: size cap, then byte-level sniffing.
 * `declaredName` is accepted ONLY to echo better error messages; it
 * never influences the verdict.
 */
export function validateUpload(
  bytes: Uint8Array,
  declaredName?: string,
): { ok: true; value: ValidatedUpload } | { ok: false; problem: string; hint?: string } {
  const sniffed = sniffContentType(bytes);
  if (!sniffed.ok) {
    const name = declaredName ? ` (${declaredName})` : "";
    return { ok: false, problem: `${sniffed.problem}${name}`, hint: sniffed.hint };
  }
  return {
    ok: true,
    value: {
      contentType: sniffed.contentType,
      ext: sniffed.ext,
      width: sniffed.width,
      height: sniffed.height,
    },
  };
}
