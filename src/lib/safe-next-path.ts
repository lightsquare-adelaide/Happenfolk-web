/**
 * Sanitise a `?next=` redirect target so that login can only send the user
 * to a path on this site.
 *
 * `startsWith("/")` on its own is not enough. `//example.com` is a
 * scheme-relative URL, and browsers (and the WHATWG URL parser) also read
 * `/\example.com` as `//example.com`. Next's router treats both as external
 * and performs a hard navigation, which would turn `?next=` into an open
 * redirect after a successful login.
 *
 * Two independent checks: a shape test on the raw string, then a parse
 * against a fixed origin to confirm the target resolves to that origin.
 * The result is rebuilt from the parsed parts so the caller never sees the
 * raw input. The rebuilt path must pass the shape check too, because URL
 * normalisation can turn dot segments into a scheme-relative destination.
 */
export function safeNextPath(
  input: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof input !== "string" || input.length === 0) return fallback;

  // Exactly one leading slash, not followed by another slash or a backslash.
  if (!/^\/(?![/\\])/.test(input)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(input, "http://localhost");
  } catch {
    return fallback;
  }
  if (resolved.origin !== "http://localhost") return fallback;

  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  if (!/^\/(?![/\\])/.test(path)) return fallback;
  return path;
}
