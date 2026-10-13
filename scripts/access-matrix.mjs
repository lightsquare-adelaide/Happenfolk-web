#!/usr/bin/env node
/**
 * Red-green verifier for the access-rule suite (BUILD_PLAN P1:
 * "每一条都要先看着它红再看着它绿").
 *
 * For every tests/access/NN-*.spec.ts file:
 *   1. GREEN: plain vitest run of the file must PASS.
 *   2. RED:   for each guard registered in that file, rerun with
 *             ACCESS_RED=<guard> — the protection is broken, so the
 *             file must FAIL. The guard's afterAll restores it either
 *             way.
 *
 * Exits non-zero if any run's outcome is the opposite of expected.
 * Prints a markdown matrix at the end for PROGRESS.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ACCESS_DIR = "tests/access";

const specFiles = fs
  .readdirSync(ACCESS_DIR)
  .filter((f) => /^\d{2}-.*\.spec\.ts$/.test(f))
  .sort();

function runVitest(file, redGuard) {
  const env = { ...process.env };
  if (redGuard) env.ACCESS_RED = redGuard;
  else delete env.ACCESS_RED;
  try {
    execFileSync("npx", ["vitest", "run", file], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: "" };
  } catch (err) {
    const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
    return { ok: false, output: out };
  }
}

function tail(output, lines = 25) {
  return output.split("\n").slice(-lines).join("\n");
}

const rows = [];
let mistakes = 0;

for (const file of specFiles) {
  const source = fs.readFileSync(path.join(ACCESS_DIR, file), "utf8");
  const guardNames = [...source.matchAll(/guard\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (guardNames.length === 0) {
    console.error(`!! ${file} registers no guard — cannot prove it can see red`);
    mistakes += 1;
    continue;
  }

  const green = runVitest(file, null);
  if (!green.ok) {
    mistakes += 1;
    console.error(`!! GREEN unexpectedly FAILED for ${file}\n${tail(green.output)}`);
  }

  const redResults = [];
  for (const g of guardNames) {
    const red = runVitest(file, g);
    redResults.push({ guard: g, sawRed: !red.ok, output: red.output });
    if (red.ok) {
      mistakes += 1;
      console.error(
        `!! RED run unexpectedly PASSED for ${file} (ACCESS_RED=${g}) — the test cannot detect the broken guard`,
      );
    } else {
      console.log(`   saw red: ${file} [${g}] failed as expected`);
    }
  }

  rows.push({ file, guards: redResults, greenOk: green.ok });
}

console.log("\n## 见红/复绿矩阵\n");
console.log("| 场景文件 | guard | 见红（应为败） | 绿（应为过） |");
console.log("|---|---|---|---|");
for (const r of rows) {
  for (const g of r.guards) {
    console.log(
      `| ${r.file} | ${g.guard} | ${g.sawRed ? "是 ✅" : "否 ❌"} | ${r.greenOk ? "是 ✅" : "否 ❌"} |`,
    );
  }
}

console.log(`\n${mistakes === 0 ? "ALL OK" : `${mistakes} MISTAKE(S)`}`);
process.exit(mistakes === 0 ? 0 : 1);
