import { expect, test } from "vitest";
import { createUser } from "./_harness";

test("profile metadata validates website URLs and enforces ownership", async () => {
  const owner = await createUser("metadata-owner");
  const stranger = await createUser("metadata-stranger");

  const metadata = {
    headline: "Ceramic artist",
    location: "Adelaide",
    website: "https://example.com/studio",
  };

  const saved = await owner.client
    .from("profiles")
    .update(metadata)
    .eq("id", owner.userId)
    .select("headline, location, website")
    .single();

  expect(saved.error).toBeNull();
  expect(saved.data).toEqual(metadata);

  const invalidWebsites = [
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com",
    "example.com",
    "https://",
    "https://example.com/a b",
    "",
  ];

  for (const website of invalidWebsites) {
    const rejected = await owner.client
      .from("profiles")
      .update({ website })
      .eq("id", owner.userId);

    expect(rejected.error?.code, website).toBe("23514");
  }

  const forbidden = await stranger.client
    .from("profiles")
    .update({
      headline: "Changed by another user",
      location: "Elsewhere",
      website: "https://other.example.com",
    })
    .eq("id", owner.userId)
    .select("id");

  expect(forbidden.error).toBeNull();
  expect(forbidden.data).toEqual([]);

  const unchanged = await owner.client
    .from("profiles")
    .select("headline, location, website")
    .eq("id", owner.userId)
    .single();

  expect(unchanged.error).toBeNull();
  expect(unchanged.data).toEqual(metadata);

  for (const website of ["http://example.com", null]) {
    const allowed = await owner.client
      .from("profiles")
      .update({ website })
      .eq("id", owner.userId)
      .select("website")
      .single();

    expect(allowed.error).toBeNull();
    expect(allowed.data?.website).toBe(website);
  }
});