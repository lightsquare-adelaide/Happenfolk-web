import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "./validate";

// Leave room for multipart metadata below Vercel's 4.5 MB payload limit.
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export function originProblem(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  // `request.url` is reconstructed by the runtime and can disagree with
  // the host the browser actually used (next start normalizes to
  // localhost even when bound to 127.0.0.1, so real same-origin browser
  // uploads were rejected while Node-fetch tests, which send no Origin,
  // stayed green). The Host the client connected to is authoritative:
  // accept it (and the proxy-forwarded variant) as same-origin too.
  const allowed = new Set([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ??
      new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin)) {
    return NextResponse.json({ error: "Cross-origin media requests are not allowed" }, { status: 403 });
  }
  return null;
}

/** Consume a bounded stream before multipart parsing; don't trust Content-Length. */
export async function readUpload(request: Request): Promise<
  {ok: true; file: File; itemId?: string; altText?: string} | {ok: false; response: NextResponse}
> {
  const rejected = (error: string, status = 400) => ({ ok: false as const, response: NextResponse.json({ error }, { status }) });
  const origin = originProblem(request);
  if (origin) return {ok: false, response: origin};
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) return rejected("File exceeds the 4 MiB upload limit", 413);
  if (!request.body) return rejected("Missing upload body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > MAX_REQUEST_BYTES) { await reader.cancel(); return rejected("File exceeds the 4 MiB upload limit", 413); }
      chunks.push(value);
    }
    const form = await new Request(request.url, {
      method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(chunks),
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) return rejected("Missing file field");
    if (file.size > MAX_UPLOAD_BYTES) return rejected("File exceeds the 4 MiB upload limit", 413);
    const itemId = form.get("itemId"); const altText = form.get("altText");
    if (altText !== null && (typeof altText !== "string" || altText.length > 2000)) return rejected("Alt text must be at most 2000 characters");
    if (itemId !== null && (typeof itemId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId))) return rejected("Invalid work identifier");
    return {ok: true, file, itemId: typeof itemId === "string" ? itemId : undefined, altText: typeof altText === "string" ? altText : undefined};
  } catch { return rejected("Request must be valid multipart/form-data"); }
  finally { reader.releaseLock(); }
}
