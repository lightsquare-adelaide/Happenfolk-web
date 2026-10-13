import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/lib/env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(VALID)).toEqual(VALID);
  });

  it("throws when a variable is missing", () => {
    expect(() =>
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("throws when the Supabase URL is not http(s)", () => {
    expect(() =>
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws on an empty environment", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment configuration/);
  });
});
