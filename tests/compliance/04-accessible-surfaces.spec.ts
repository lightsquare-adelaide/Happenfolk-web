import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("launch accessibility and sample disclosure", () => {
  it("retains keyboard focus styling and a skip link destination", () => {
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(tsx|css)$/.test(file)) {
          const source = readFileSync(file, "utf8");
          if (/outline:\s*(none|0)|outline-none/.test(source) && !/focus-visible|focus:outline|focus:ring/.test(source)) offenders.push(file);
        }
      }
    }
    walk("src/app"); walk("src/components");
    expect(offenders).toEqual([]);
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('id="main-content"');
  });
  it("labels every sample artist and uses reserved contact domains", () => {
    const sql = readFileSync("supabase/seed.sql", "utf8");
    expect(sql).toContain("Sample data");
    expect(sql).toContain("@example.test");
    expect(sql).not.toContain("demo.artist@happenfolk.test");
    expect(sql).not.toMatch(/@(?:gmail|outlook|hotmail)\.com/);
  });
});
