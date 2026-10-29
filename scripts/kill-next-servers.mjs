// Terminate only this user's Next servers whose cwd is this exact checkout.
import { execFileSync } from "node:child_process";
import { readlinkSync, realpathSync } from "node:fs";
const repo = realpathSync(process.cwd());
let pids = [];
try {
  pids = execFileSync("pgrep", ["-u", String(process.getuid()), "-f", "next-server|next/dist/bin/next"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\s+/).map(Number);
} catch { /* No matches. */ }
let count = 0;
for (const pid of pids) {
  if (!pid || pid === process.pid || pid === process.ppid) continue;
  try {
    let cwd;
    if (process.platform === "darwin") {
      const result = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
      cwd = result.split("\n").find((s) => s.startsWith("n"))?.slice(1);
    } else cwd = readlinkSync(`/proc/${pid}/cwd`);
    if (cwd && realpathSync(cwd) === repo) { process.kill(pid, "SIGTERM"); count++; }
  } catch { /* Process already exited or cwd is not accessible. */ }
}
console.log(`Terminated ${count} Next server process(es) in this checkout.`);
