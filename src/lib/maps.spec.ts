import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl } from "./maps";
import { EVENT_LOCATION_MAX } from "./events";

/** Extracts the decoded query parameter from a built Maps URL. */
function decodedQuery(url: string): string {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("https:");
  expect(parsed.hostname).toBe("www.google.com");
  expect(parsed.pathname).toBe("/maps/search/");
  expect(parsed.searchParams.get("api")).toBe("1");
  const query = parsed.searchParams.get("query");
  expect(query, "the URL must always carry a query parameter").not.toBeNull();
  return query as string;
}

describe("googleMapsSearchUrl", () => {
  it("builds the official Maps search URL for a venue", () => {
    expect(googleMapsSearchUrl("Sample venue, Port Adelaide")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Sample%20venue%2C%20Port%20Adelaide",
    );
  });

  it("trims surrounding whitespace before encoding", () => {
    expect(decodedQuery(googleMapsSearchUrl("  Elder Park, Adelaide  ")!)).toBe("Elder Park, Adelaide");
  });

  it("rejects empty and whitespace-only venues", () => {
    expect(googleMapsSearchUrl("")).toBeNull();
    expect(googleMapsSearchUrl("   ")).toBeNull();
    expect(googleMapsSearchUrl("\t\n")).toBeNull();
  });

  it("rejects missing and non-string values", () => {
    expect(googleMapsSearchUrl(null)).toBeNull();
    expect(googleMapsSearchUrl(undefined)).toBeNull();
    expect(googleMapsSearchUrl(42)).toBeNull();
    expect(googleMapsSearchUrl({ venue: "x" })).toBeNull();
  });

  it("caps the query at EVENT_LOCATION_MAX characters", () => {
    const long = "A".repeat(EVENT_LOCATION_MAX + 50);
    const url = googleMapsSearchUrl(long);
    expect(url).not.toBeNull();
    expect(decodedQuery(url as string)).toHaveLength(EVENT_LOCATION_MAX);
    expect(url).not.toContain("A".repeat(EVENT_LOCATION_MAX + 1));
  });

  it("keeps a venue at exactly the cap intact", () => {
    const exact = "B".repeat(EVENT_LOCATION_MAX);
    expect(decodedQuery(googleMapsSearchUrl(exact)!)).toBe(exact);
  });

  it("percent-encodes characters that break URLs and includes Unicode venues as-is", () => {
    expect(decodedQuery(googleMapsSearchUrl("Cafe & Bar, Adelaide")!)).toBe("Cafe & Bar, Adelaide");
    const url = googleMapsSearchUrl("Cafe & Bar, Adelaide")!;
    expect(url).toContain("Cafe%20%26%20Bar%2C%20Adelaide");
    expect(decodedQuery(googleMapsSearchUrl("伦敦街 1 号")!)).toBe("伦敦街 1 号");
    expect(googleMapsSearchUrl("伦敦街 1 号")!).toContain(encodeURIComponent("伦敦街 1 号"));
  });
});
