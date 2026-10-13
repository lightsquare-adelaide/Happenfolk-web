import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

/** Promise-based sleep (withResolvers keeps the flow linear). */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Harness for the P2 auth-flow tests.
 *
 * Ground rules (from the brief):
 * - Real local Supabase stack + real Next server (`next start`). Auth
 *   is NEVER mocked.
 * - Middleware behaviour is asserted over real HTTP with
 *   `fetch(…, { redirect: "manual" })`.
 * - Login state for HTTP tests is produced by @supabase/ssr itself:
 *   a server client with captured cookie writes gives us the exact
 *   cookie names/values the middleware expects — nothing forged.
 * - Password reset is verified end-to-end through the Mailpit API
 *   (no human clicking links).
 */

export type TestUser = {
  client: SupabaseClient;
  userId: string;
  email: string;
  password: string;
};

type StackConfig = {
  url: string;
  anonKey: string;
  mailpitUrl: string;
};

let stack: StackConfig | null = null;

export function stackConfig(): StackConfig {
  if (stack) return stack;
  let out: string;
  try {
    out = execSync("supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Local kepler-vps shells need the docker group via sg(1).
    out = execSync('sg docker -c "supabase status -o env"', { encoding: "utf8" });
  }
  const kv: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+)=(.*)$/gm)) {
    kv[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  if (!kv.API_URL || !kv.ANON_KEY || !kv.MAILPIT_URL) {
    throw new Error("could not read local Supabase status (API_URL/ANON_KEY/MAILPIT_URL)");
  }
  stack = { url: kv.API_URL, anonKey: kv.ANON_KEY, mailpitUrl: kv.MAILPIT_URL };
  return stack;
}

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Signs up a fresh user on the LOCAL stack (confirmations are off). */
export async function createUser(label: string): Promise<TestUser> {
  const { url, anonKey } = stackConfig();
  const email = `${label}-${runId}@auth.test`;
  const password = `pw-${runId}-ok`;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user || !data.session) {
    throw new Error(`signUp failed for ${label}: ${error?.message ?? "no session"}`);
  }
  return { client, userId: data.user.id, email, password };
}

/**
 * Signs in through a server-side @supabase/ssr client with captured
 * cookie writes and returns the exact `Cookie` header the middleware
 * will accept. Nothing here is forged — it is what a browser would
 * carry after the same sign-in.
 */
export async function sessionCookieHeader(email: string, password: string): Promise<string> {
  const { url, anonKey } = stackConfig();
  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll(toSet) {
        for (const { name, value } of toSet) jar.push({ name, value });
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`);
  if (jar.length === 0) throw new Error("no session cookies were written");
  return jar.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Marks the user's onboarding complete by updating their own row (RLS-checked). */
export async function completeOnboarding(user: TestUser): Promise<void> {
  const { error } = await user.client
    .from("profiles")
    .update({ category_id: 1, account_kind: "individual" })
    .eq("id", user.userId);
  if (error) throw new Error(`completeOnboarding failed: ${error.message}`);
}

// ---------------- Next server lifecycle ----------------

// PID-derived port: a stale server from an earlier run can never be
// mistaken for the one this process started (it happened once and the
// suite silently served a stale build — see PROGRESS.md).
const PORT = 3005 + (process.pid % 500);
export function appBase(): string {
  return `http://127.0.0.1:${PORT}`;
}

let app: { close: () => Promise<void> } | null = null;

/** Build inputs, newest mtime wins. Directories are walked recursively. */
const BUILD_INPUTS = [
  "src",
  "next.config.ts",
  "package.json",
  "tsconfig.json",
  "postcss.config.mjs",
];

/** Newest mtime (ms) across everything `next build` consumes. */
function newestInputMtime(root: string): number {
  let newest = 0;
  const visit = (target: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return; // optional input, absent in this tree
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        visit(path.join(target, entry));
      }
      return;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  for (const input of BUILD_INPUTS) visit(path.join(root, input));
  return newest;
}

/** Builds (when stale) and starts `next start`, waits until it serves. */
export async function startApp(): Promise<{ close: () => Promise<void> }> {
  if (app) return app;
  const root = process.cwd();

  // An existing build is reused ONLY if it is newer than every build
  // input. The check here used to be `existsSync(BUILD_ID)`, which
  // silently served whatever .next happened to hold from an earlier run:
  // `npm run test:auth` would then verify code that was no longer in the
  // working tree, and report green. That is how the /onboarding redirect
  // loop survived a red-green check — reverting the fix still passed,
  // because the stale build still contained it. Equal mtimes rebuild:
  // a build is only trusted if it is strictly newer than its inputs.
  const buildId = path.join(root, ".next", "BUILD_ID");
  const builtAt = fs.existsSync(buildId) ? fs.statSync(buildId).mtimeMs : 0;
  if (builtAt <= newestInputMtime(root)) {
    execSync("npx next build", {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
  }

  // The local CLI (no npx wrapper), so cleanup can kill the whole tree —
  // a surviving server from a previous run would serve a STALE build to
  // these tests.
  //
  // Run it through `process.execPath` rather than `node_modules/.bin/next`:
  // on Windows that path is a `.cmd` shim, which `spawn` cannot execute
  // without `shell: true`. The script below is what next's own `bin` field
  // resolves to, so this is the same entry point on every platform.
  //
  // `detached` buys a POSIX process group for the group-kill in killTree.
  // On Windows it instead means "outlive the parent in a new console", which
  // is the opposite of what we want — killTree walks the tree there instead.
  const child = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(PORT),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: root,
      stdio: "ignore",
      detached: process.platform !== "win32",
      env: { ...process.env, NODE_ENV: "production" },
    },
  );

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `next start exited early (code ${child.exitCode}) — port ${PORT} busy?`,
      );
    }
    if (Date.now() > deadline) {
      killTree(child.pid);
      throw new Error("next start did not become ready within 30s");
    }
    try {
      const res = await fetch(appBase(), { redirect: "manual" });
      if (res.status > 0) break;
    } catch {
      // not up yet
    }
    await sleep(250);
  }

  app = {
    close: async () => {
      killTree(child.pid);
      app = null;
    },
  };
  return app;
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;

  // Windows has no process groups, so `process.kill(-pid)` throws there and
  // the fallback below would reach only `next start` itself — its workers
  // would survive and serve a STALE build to the next run, defeating the
  // freshness check above. `taskkill /T` walks the tree by PID instead.
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } catch {
      // already gone
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

// ---------------- Mailpit ----------------

/**
 * Pulls the recovery email for `email` out of Mailpit and returns the
 * `token` query parameter (the token hash GoTrue embeds in the link).
 */
export async function fetchRecoveryToken(email: string): Promise<string> {
  const { mailpitUrl } = stackConfig();
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`no recovery email for ${email} within 15s`);
    const list = (await (await fetch(`${mailpitUrl}/api/v1/messages`)).json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const hit = list.messages.find((m) => m.To.some((t) => t.Address === email));
    if (hit) {
      const detail = (await (
        await fetch(`${mailpitUrl}/api/v1/message/${hit.ID}`)
      ).json()) as { Text: string; HTML: string };
      const haystack = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`;
      const match = haystack.match(/token=([^&"'\s]+)/);
      if (!match) throw new Error("recovery email found but no token parameter in link");
      return decodeURIComponent(match[1]);
    }
    await sleep(500);
  }
}
