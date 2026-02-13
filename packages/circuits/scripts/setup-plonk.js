#!/usr/bin/env node

import { existsSync } from "fs";
import { spawnSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = join(__dirname, "..");
const PTAU_DIR = join(CIRCUITS_DIR, "ptau");
const DEFAULT_PTAU = "powersOfTau28_hez_final_25.ptau";

function resolvePtauName(input) {
  if (!input) return DEFAULT_PTAU;
  const value = String(input).trim();
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    if (n === 28) return "powersOfTau28_hez_final.ptau";
    return `powersOfTau28_hez_final_${n}.ptau`;
  }
  return value.endsWith(".ptau") ? value : `${value}.ptau`;
}

const requestedName = process.env.PTAU_FILE || process.env.PTAU_SIZE;
const ptauName = resolvePtauName(requestedName);
const ptauPath = join(PTAU_DIR, ptauName);

if (!existsSync(ptauPath)) {
  const suggestedSize = ptauName.includes("final.ptau")
    ? "28"
    : ptauName.match(/_(\d+)\.ptau$/)?.[1] || "25";
  console.error(`Missing PTAU file: ${ptauPath}`);
  console.error(`Run: PTAU_SIZE=${suggestedSize} pnpm ptau:download`);
  process.exit(1);
}

console.log(`Using PTAU: ${ptauPath}`);

const cmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(cmd, ["exec", "circomkit", "setup", "shadow", ptauPath], {
  cwd: CIRCUITS_DIR,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message);
}
process.exit(1);
