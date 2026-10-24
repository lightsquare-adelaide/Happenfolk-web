import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Media-suite fixtures, all synthesized on the spot with ffmpeg /
 * exiftool — no real photographs, no binaries of unknown origin
 * (brief rule). The auth harness (fixed to always rebuild) provides
 * the real Next server; importing and re-exporting keeps that fix in
 * one place without touching P2 test files.
 */

export {
  stackConfig,
  createUser,
  sessionCookieHeader,
  type TestUser,
} from "../auth/_harness";

const run = promisify(execFile);

export type FixtureSet = {
  dir: string;
  h264Mp4: Buffer;
  hevcMov: Buffer;
  pdfRenamedJpg: Buffer;
  gpsJpg: Buffer;
  oversizeJpg: Buffer;
};

async function makeTestFrame(out: string, size: string): Promise<void> {
  await run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi",
    "-i", `testsrc=size=${size}:rate=15:duration=1`,
    "-frames:v", "1",
    "-q:v", "2",
    out,
  ]);
}

/** Reads `fields` back from a media file and fails when any is absent. */
async function exiftoolFields(file: string, fields: string[]): Promise<Record<string, string>> {
  const { stdout } = await run("exiftool", ["-j", ...fields.map((f) => `-${f}`), file]);
  const parsed = JSON.parse(stdout) as Record<string, string>[];
  return parsed[0] ?? {};
}

export async function buildFixtures(): Promise<FixtureSet> {
  const dir = await mkdtemp(path.join(tmpdir(), "lightsquare-media-"));
  const j = (name: string) => path.join(dir, name);

  // H.264 in an .mp4 (moov at EOF by default) — must be accepted.
  await run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi",
    "-i", "testsrc=size=640x480:rate=15:duration=2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    j("good.mp4"),
  ]);

  // HEVC in a QuickTime container (moov also near EOF) — must be rejected.
  await run("ffmpeg", [
    "-v", "error",
    "-f", "lavfi",
    "-i", "testsrc=size=640x480:rate=15:duration=2",
    "-c:v", "libx265",
    "-tag:v", "hvc1",
    j("bad.mov"),
  ]);

  // A real JPEG with privacy-critical EXIF injected.
  await makeTestFrame(j("gps.jpg"), "640x480");
  await run("exiftool", [
    "-overwrite_original",
    "-GPSLatitude=-34.9285",
    "-GPSLatitudeRef=S",
    "-GPSLongitude=138.5999",
    "-GPSLongitudeRef=E",
    "-Model=iPhone 15",
    j("gps.jpg"),
  ]);
  const gpsCheck = await exiftoolFields(j("gps.jpg"), ["GPSLatitude", "Model"]);
  if (!gpsCheck.GPSLatitude || !gpsCheck.Model) {
    throw new Error("fixture broken: exiftool did not inject GPS/Model into gps.jpg");
  }

  // A PDF wearing a .jpg name (true JPEG magic is ff d8 ff, PDF is %PDF).
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "utf8",
  );

  const gpsJpg = await readFile(j("gps.jpg"));

  // Valid JPEG magic with junk padding past the 10 MB cap.
  const oversize = Buffer.concat([gpsJpg, Buffer.alloc(10 * 1024 * 1024 + 1)]);

  return {
    dir,
    h264Mp4: await readFile(j("good.mp4")),
    hevcMov: await readFile(j("bad.mov")),
    pdfRenamedJpg: pdf,
    gpsJpg,
    oversizeJpg: oversize,
  };
}

export async function cleanupFixtures(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Runs exiftool -j over a buffer written to a temp file. */
export async function exiftoolOnBuffer(
  name: string,
  data: Buffer,
  fields: string[],
): Promise<Record<string, string>> {
  const dir = await mkdtemp(path.join(tmpdir(), "lightsquare-exif-"));
  const file = path.join(dir, name);
  try {
    await writeFile(file, data);
    return await exiftoolFields(file, fields);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Authenticated JSON request against the real Next server. */
export function jsonRequest(cookie: string, body: unknown): RequestInit {
  return {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Multipart upload request with a deliberately misleading part type. */
export function uploadRequest(
  cookie: string,
  name: string,
  data: Buffer,
  opts: { itemId?: string; altText?: string } = {},
): RequestInit {
  const form = new FormData();
  // The declared type is ALWAYS a lie the server must see through.
  form.append("file", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), name);
  if (opts.itemId) form.append("itemId", opts.itemId);
  if (opts.altText !== undefined) form.append("altText", opts.altText);
  return { method: "POST", redirect: "manual", headers: { cookie }, body: form };
}

import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";

// The P2 auth harness derives its server port from the vitest PID
// (3005 + pid % 500) and trusts whichever server answers there. When
// an unrelated local daemon already owns that port, the readiness
// probe sees ITS 200 and every media test ends up asserting against
// a stranger's app (observed: a static "耳朵" site answered the whole
// suite). This suite owns its server lifecycle instead: claim a port
// that is verifiably free, start Next there, and accept readiness only
// when THIS app answers on a route no other local app has —
// GET /api/media/avatar, which must answer 405 because the route
// exports POST only.

const PORT_MIN = 3005;
const PORT_SPAN = 500;

let port = 0;
let child: ChildProcess | null = null;

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function portFree(candidate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(candidate, "127.0.0.1");
  });
}

async function claimPort(): Promise<number> {
  const first = PORT_MIN + (process.pid % PORT_SPAN);
  for (let offset = 0; offset < PORT_SPAN; offset += 1) {
    const candidate = PORT_MIN + ((first - PORT_MIN + offset) % PORT_SPAN);
    if (await portFree(candidate)) return candidate;
  }
  throw new Error(`no free port found in ${PORT_MIN}..${PORT_MIN + PORT_SPAN - 1}`);
}

// Build freshness — same rule as the P2 harness: a build is trusted
// only when it is strictly newer than every input `next build` reads.
const BUILD_INPUTS = ["src", "next.config.ts", "package.json", "tsconfig.json", "postcss.config.mjs"];

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
      for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
      return;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  for (const input of BUILD_INPUTS) visit(path.join(root, input));
  return newest;
}

function buildIfStale(): void {
  const root = process.cwd();
  const buildId = path.join(root, ".next", "BUILD_ID");
  const builtAt = fs.existsSync(buildId) ? fs.statSync(buildId).mtimeMs : 0;
  if (builtAt <= newestInputMtime(root)) {
    execSync("npx next build", {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    });
  }
}

/** Only this app maps /api/media/avatar; GET there must answer 405. */
async function answersLikeOurApp(base: string): Promise<number> {
  try {
    const response = await fetch(`${base}/api/media/avatar`, { redirect: "manual" });
    return response.status;
  } catch {
    return 0; // not listening yet
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM"); // detached → own process group
  } catch {
    /* already gone */
  }
}

export function appBase(): string {
  if (!port) throw new Error("appBase() called before startApp()");
  return `http://127.0.0.1:${port}`;
}

export async function startApp(): Promise<{ close: () => Promise<void> }> {
  if (child) return { close: () => closeApp() };
  buildIfStale();
  const root = process.cwd();

  for (let attempt = 0; attempt < 3 && !child; attempt += 1) {
    const candidate = await claimPort();
    const spawned = spawn(
      process.execPath,
      [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(candidate), "-H", "127.0.0.1"],
      { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, NODE_ENV: "production" } },
    );
    const base = `http://127.0.0.1:${candidate}`;
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (spawned.exitCode !== null) break; // died (port taken?) → retry
      const status = await answersLikeOurApp(base);
      if (status === 405) {
        child = spawned;
        port = candidate;
        break;
      }
      if (status !== 0 && status !== 404 && status !== 200) {
        // Something answered that is not this app — do not wait.
        break;
      }
      if (Date.now() > deadline) break;
      await sleep(250);
    }
    if (!child) {
      killTree(spawned.pid);
      await sleep(250);
    }
  }

  if (!child) {
    throw new Error("could not start a verified Next server on a free port");
  }
  return { close: () => closeApp() };
}

export async function closeApp(): Promise<void> {
  const server = child;
  child = null;
  port = 0;
  if (!server) return;
  killTree(server.pid);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
