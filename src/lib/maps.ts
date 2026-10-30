/**
 * Google Maps URL builder (pure, framework-free).
 *
 * The event pages link a saved venue straight to a Google Maps search.
 * Building the URL lives here so both the public event page and the
 * studio events manager share one rule set:
 *   - input is trimmed; an empty or whitespace-only venue yields null
 *     (callers render no link rather than a broken one);
 *   - the query is capped at EVENT_LOCATION_MAX characters, matching
 *     the bound the event forms and the server already enforce, so the
 *     builder stays safe for any string a caller hands it.
 *
 * The https://www.google.com/maps/search/?api=1&query=... shape is the
 * official Google Maps URL scheme for a plain place search.
 */

import { EVENT_LOCATION_MAX } from "./events";

const MAPS_SEARCH_BASE = "https://www.google.com/maps/search/?api=1&query=";

/** Returns the Maps search URL for a venue, or null when there is nothing to link. */
export function googleMapsSearchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const query = value.trim().slice(0, EVENT_LOCATION_MAX);
  if (!query) return null;
  return `${MAPS_SEARCH_BASE}${encodeURIComponent(query)}`;
}
