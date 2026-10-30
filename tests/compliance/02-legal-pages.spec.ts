import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURATED_ARTWORK } from "../../src/lib/artwork";

/**
 * Verifies that /about, /privacy, /terms, /licence and /credits exist,
 * cover the required disclosures (viewer_id, 90-day retention, non-exclusive
 * revocable licence, content responsibility, and museum CC0 provenance),
 * and are linked from the shared site footer.
 */
describe("compliance · about, legal & credits disclosures", () => {
  const root = process.cwd();

  it("ships /about, /privacy, /terms, /licence and /credits with accurate disclosures", () => {
    const about = readFileSync(join(root, "src/app/about/page.tsx"), "utf8");
    expect(about).toContain("Supabase");
    expect(about).toContain("Vercel");
    expect(about).toContain("/collaborate");

    const privacy = readFileSync(
      join(root, "src/app/privacy/page.tsx"),
      "utf8",
    );
    expect(privacy).toContain("viewer_id");
    expect(privacy).toContain("90 days");
    expect(privacy).toContain("page_views_monthly");
    expect(privacy).toContain("record that it was you browsing");
    expect(privacy).toContain("Australian Privacy Principles");

    const terms = readFileSync(join(root, "src/app/terms/page.tsx"), "utf8");
    expect(terms).toContain("South Australia");
    expect(terms).toContain("Content responsibility");

    const licence = readFileSync(
      join(root, "src/app/licence/page.tsx"),
      "utf8",
    );
    expect(licence).toContain("non-exclusive");
    expect(licence).toContain("terminated");
    expect(licence).toContain("Copyright Act 1968");

    const credits = readFileSync(
      join(root, "src/app/credits/page.tsx"),
      "utf8",
    );
    expect(credits).toContain("CURATED_ARTWORK");
    expect(credits).toContain("CC0 1.0");
  });

  it("links /about, /collaborate, /privacy, /terms, /licence and /credits in the shared footer", () => {
    const footer = readFileSync(
      join(root, "src/components/site-footer.tsx"),
      "utf8",
    );
    for (const route of [
      "/about",
      "/collaborate",
      "/privacy",
      "/terms",
      "/licence",
      "/credits",
    ]) {
      expect(footer).toContain(`href="${route}"`);
    }
  });

  it("keeps CURATED_ARTWORK in sync with docs/design/artwork-sources.json", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "docs/design/artwork-sources.json"), "utf8"),
    ) as {
      images: Array<{
        file: string;
        title: string;
        creator: string;
        license: string;
        sourceUrl: string;
      }>;
    };
    expect(manifest.images.length).toBe(CURATED_ARTWORK.length);
    for (const img of manifest.images) {
      expect(img.license).toBe("CC0 1.0");
      expect(img.sourceUrl).toMatch(/^https:\/\/www\.artic\.edu\/artworks\//);
      const match = CURATED_ARTWORK.find((a) => a.file === img.file);
      expect(match).toBeDefined();
      expect(match?.creator).toBe(img.creator);
    }
  });
});

describe("team content accuracy", () => {
  it("describes the team's categories and shipped fonts", () => {
    const about = readFileSync(join(process.cwd(), "src/app/about/page.tsx"), "utf8");
    expect(about).toContain("seven");
    expect(about).toContain("Photography");
    expect(about).toContain("Food");
    const credits = readFileSync(join(process.cwd(), "src/app/credits/page.tsx"), "utf8");
    expect(credits).toContain("Archivo");
    expect(credits).toContain("Instrument Sans");
    expect(credits).not.toContain("Fraunces");
  });
});
