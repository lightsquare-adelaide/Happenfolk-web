import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export const taskBase = "http://127.0.0.1:3103";

function newestInput(target: string): number {
  if (!existsSync(target)) return 0;
  if (statSync(target).isDirectory()) {
    return Math.max(0, ...readdirSync(target).map((name) => newestInput(path.join(target, name))));
  }
  return statSync(target).mtimeMs;
}

/** Own only the assigned Task B port; never reuse or terminate another server. */
export async function startTaskApp(): Promise<{ close: () => Promise<void> }> {
  const root = process.cwd();
  const next = path.join(root, "node_modules/next/dist/bin/next");
  const buildId = path.join(root, ".next/BUILD_ID");
  const inputs = ["src", "package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"];
  if (!existsSync(buildId) || statSync(buildId).mtimeMs <= Math.max(...inputs.map(newestInput))) {
    execFileSync("nice", ["-n", "10", process.execPath, next, "build"], { stdio: "inherit" });
  }
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(3103, "127.0.0.1", () => probe.close(() => resolve()));
  });
  const child = spawn(process.execPath, [next, "start", "-p", "3103", "-H", "127.0.0.1"], {
    cwd: root, stdio: "ignore", env: { ...process.env, NODE_ENV: "production" },
  });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  };
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Task B server exited: ${child.exitCode}`);
    try {
      const response = await fetch(`${taskBase}/api/likes`);
      if (response.status === 405) return { close };
    } catch { /* Wait for our child to bind. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await close();
  throw new Error("Task B server did not become ready on port 3103");
}
