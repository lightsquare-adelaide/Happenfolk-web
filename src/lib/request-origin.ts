/** Validate browser-originated mutations while allowing non-browser clients. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const url = new URL(request.url);
  const allowed = new Set([url.origin]);
  // Next can reconstruct the URL with localhost behind a proxy. The
  // browser-controlled Host (or hosting proxy's forwarded host) preserves
  // the actual origin used by the form, including its development port.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1);
    allowed.add(`${protocol}://${host}`);
  }
  return allowed.has(origin);
}
