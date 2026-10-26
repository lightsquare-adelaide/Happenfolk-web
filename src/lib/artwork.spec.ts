import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURATED_ARTWORK,
  artworkSrc,
  attributionLine,
  pickArtwork,
} from "./artwork";

const PUBLIC_DIR = path.join(process.cwd(), "public", "artwork");

describe("curated artwork manifest", () => {
  it("keeps complete attribution on every entry", () => {
    for (const entry of CURATED_ARTWORK) {
      for (const field of ["file", "alt", "title", "creator", "year", "license", "source", "sourceUrl"] as const) {
        expect(entry[field], `${entry.file}: ${field}`).toBeTruthy();
      }
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("describes the pixels instead of reusing the title as alt text", () => {
    // The lead's artwork review found old manifest titles that did not match
    // the actual files. Alt text is written from inspection, so it must be a
    // description of its own and must not simply restate the title.
    for (const entry of CURATED_ARTWORK) {
      expect(entry.alt.length, entry.file).toBeGreaterThan(40);
      expect(entry.alt.toLowerCase(), entry.file).not.toContain(entry.title.toLowerCase());
      expect(entry.alt.endsWith("."), entry.file).toBe(true);
    }
  });

  it("ships the actual files it references", () => {
    for (const entry of CURATED_ARTWORK) {
      const file = path.join(PUBLIC_DIR, entry.file);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeGreaterThan(5_000);
      expect(artworkSrc(entry)).toBe(`/artwork/${entry.file}`);
    }
  });

  it("credits the historical artist, not a Happenfolk member", () => {
    for (const entry of CURATED_ARTWORK) {
      const line = attributionLine(entry);
      expect(line).toContain(entry.creator);
      expect(line).toContain(entry.year);
      expect(line).toContain(entry.license);
      expect(line).toContain(entry.source);
    }
  });
});

describe("pickArtwork", () => {
  it("is deterministic for a key", () => {
    expect(pickArtwork("login").file).toBe(pickArtwork("login").file);
    expect(pickArtwork("onboarding")).toEqual(pickArtwork("onboarding"));
  });

  it("always returns a curated entry", () => {
    for (const key of ["login", "register", "forgot-password", "reset-password", "onboarding", ""]) {
      expect(CURATED_ARTWORK).toContain(pickArtwork(key));
    }
  });

  it("spreads the known auth surfaces across more than one work", () => {
    const keys = ["login", "register", "forgot-password", "reset-password", "onboarding"];
    const picks = new Set(keys.map((key) => pickArtwork(key).file));
    expect(picks.size).toBeGreaterThan(1);
  });
});
