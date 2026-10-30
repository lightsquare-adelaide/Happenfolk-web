import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("remote sample tooling consent and target guards", () => {
  for (const script of ["seed-prod", "unseed-prod"]) {
    it(`${script} refuses without --yes before reading local credentials`, () => {
      const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("requires --yes");
    });
    it(`${script} refuses missing explicit remote credentials even with --yes`, () => {
      const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, "--yes"], { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SEED_SUPABASE_URL");
    });
    it(`${script} rejects a mismatched target without contacting a host`, () => {
      const result = spawnSync(process.execPath, [`scripts/${script}.mjs`, "--yes"], { encoding: "utf8", env: {
        NODE_ENV: "test", PATH: process.env.PATH, SEED_SUPABASE_URL: "https://example.test", SEED_SERVICE_ROLE_KEY: "example-service-key", SEED_TARGET: "different.example.test", SEED_PASSWORD: "Sample-Example-2026!",
      } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SEED_TARGET must match");
    });
  }
});
