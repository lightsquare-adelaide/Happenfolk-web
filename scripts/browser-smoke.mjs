#!/usr/bin/env node
/**
 * Browser smoke: scripts/browser-smoke.mjs <baseUrl>
 *
 * Renders pages with the system chromium (--headless=new, no sandbox)
 * and inspects the DOM *after JavaScript executed*:
 *   - /login and /register contain an <input type="email"> and an
 *     <input type="password"> (the forms hydrate instead of crashing);
 *   - /forgot-password contains an <input type="email">;
 *   - none of those pages, nor /, /discover, /events, shows the
 *     "Something went wrong" error boundary.
 *
 * This catches client-side crashes that plain HTTP smoke tests cannot
 * see: the 200 comes from the server-rendered shell, then the client
 * bundle throws and Next replaces the tree with the error screen.
 *
 * No new dependencies. Exit code 0 only if every assertion holds.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const baseUrl = process.env.BASE_URL || process.argv[2];
if (!baseUrl) {
  console.error("usage: scripts/browser-smoke.mjs <baseUrl>");
  process.exit(1);
}
const base = baseUrl.replace(/\/$/, "");

const CHROMIUM = process.env.CHROMIUM_PATH || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].find((p) => existsSync(p));
if (!CHROMIUM) throw new Error("Install Chromium or set CHROMIUM_PATH");
const profile = mkdtempSync(path.join(tmpdir(), "happenfolk-browser-smoke-"));
process.on("exit", () => rmSync(profile, { recursive: true, force: true }));
const TIMEOUT_MS = 30_000;

/** Render one URL headlessly and return the post-JS DOM. */
function render(path) {
  return execFileSync(
    CHROMIUM,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
            "--disable-gpu",
      "--virtual-time-budget=10000",
      "--dump-dom",
      base + path,
    ],
    { encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] },
  );
}

let failed = false;
function check(name, ok, detail = "") {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const PAGES = ["/", "/discover", "/events", "/login", "/register", "/forgot-password"];
const doms = {};
for (const page of PAGES) {
  try {
    doms[page] = render(page);
    check(`render ${page}`, true);
  } catch (err) {
    doms[page] = "";
    failed = true;
    check(`render ${page}`, false, String(err.message ?? err).slice(0, 120));
  }
}

function hasInput(page, type) {
  return new RegExp(`<input[^>]*type="${type}"`).test(doms[page] ?? "");
}

check('/login has type="email"', hasInput("/login", "email"));
check('/login has type="password"', hasInput("/login", "password"));
check('/register has type="email"', hasInput("/register", "email"));
check('/register has type="password"', hasInput("/register", "password"));
check('/forgot-password has type="email"', hasInput("/forgot-password", "email"));

for (const page of PAGES) {
  const crashed = /Something went wrong/.test(doms[page] ?? "");
  check(`${page} free of "Something went wrong"`, !crashed);
}

console.log(`\nbrowser-smoke ${base}: ${failed ? "FAILED" : "all assertions passed"}`);
process.exit(failed ? 1 : 0);
