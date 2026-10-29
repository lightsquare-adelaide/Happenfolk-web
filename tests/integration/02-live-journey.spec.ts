import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appBase, startApp } from "../auth/_harness";
import { withPg, anonClient } from "../compliance/_harness";

const run = promisify(execFile);
let server: Awaited<ReturnType<typeof startApp>> | undefined;
beforeAll(async () => { server = await startApp(); }, 300_000);
afterAll(async () => { await server?.close(); });

describe("launch integration against a seeded production server", () => {
  it("passes the deployed-surface smoke script", async () => {
    const { stdout } = await run(process.execPath, ["scripts/smoke.mjs"], {
      env: { ...process.env, BASE_URL: appBase() }, timeout: 120_000,
    });
    expect(stdout).toContain("Smoke passed");
  }, 130_000);
  it("renders real sample cards and accessible page structure", async () => {
    const res = await fetch(appBase());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('id="main-content"');
    expect(html).toContain("Sample");
    expect((html.match(/href="\/events\//g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((html.match(/href="\/artists\//g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
  it("renders not-found for hidden and draft sample details, with a visible positive control", async () => {
    for (const route of [
      "/artists/sample_artist_38", "/artists/sample_artist_39",
      "/items/fa000003-0000-4000-8000-000000000111",
      "/items/fa000003-0000-4000-8000-000000000120",
      "/events/fa000002-0000-4000-8000-000000000079",
      "/events/fa000002-0000-4000-8000-000000000084",
    ]) {
      const res = await fetch(appBase() + route, { redirect: "manual" });
      const html = await res.text();
      // Next streams metadata: notFound() can follow already-sent 200 headers.
      expect(res.status === 404 || (res.status === 200 && html.includes("NEXT_HTTP_ERROR_FALLBACK;404") && html.includes('name="robots" content="noindex"')), route).toBe(true);
      expect(html).not.toContain("Sample Finley Studio 38");
      expect(html).not.toContain("Sample Harper Studio 39");
    }
    expect((await fetch(appBase() + "/items/fa000003-0000-4000-8000-000000000001")).status).toBe(200);
    const { data, error } = await anonClient().rpc("search_items", { p_query: "Sample", p_limit: 200 });
    expect(error).toBeNull();
    expect(data?.some((r: { id: string }) => r.id === "fa000003-0000-4000-8000-000000000001")).toBe(true);
    expect(data?.some((r: { id: string }) => r.id === "fa000003-0000-4000-8000-000000000111")).toBe(false);
  });
  it("completes signup, media, free registration, paid retry and cleanup", async () => {
    const { stdout } = await run(process.execPath, ["scripts/e2e.mjs"], {
      env: { ...process.env, BASE_URL: appBase() }, timeout: 180_000,
    });
    expect(stdout).toContain("E2E passed");
    expect(stdout).toContain("PASS cleanup account");
    await withPg(async (db) => {
      const { rows } = await db.query("select id from auth.users where email like 'e2e-%@example.test'");
      expect(rows).toEqual([]);
    });
  }, 190_000);
});
