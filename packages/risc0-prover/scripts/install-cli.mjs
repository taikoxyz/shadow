#!/usr/bin/env node

import os from "os";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 18) {
    throw new Error(`Node.js >= 18 is required (found ${process.versions.node}).`);
  }

  const env = withToolchainPath(process.env);

  console.log("== Shadow CLI install ==");
  console.log("Package:", PACKAGE_ROOT);

  ensureCmd("cargo", ["--version"], { env });

  if (!hasCmd("docker", ["--version"], { env })) {
    console.log("Warning: docker not found. Groth16 receipts require Docker for risc0-groth16 shrinkwrap.");
  }

  if (!hasCmd("rzup", ["--version"], { env })) {
    console.log("rzup not found; installing via cargo...");
    run("cargo", ["install", "rzup", "--locked"], { env });
  }

  // Install the full RISC0 toolchain (includes risc0-groth16 artifacts).
  console.log("Installing RISC0 toolchain via rzup...");
  run("rzup", ["install"], { env });

  // Install JS deps for shadowcli.
  console.log("Installing JS dependencies (no lockfile)...");
  run("npm", ["install", "--no-package-lock"], { cwd: PACKAGE_ROOT, env });

  // Build the host binary.
  console.log("Building shadow-risc0-host...");
  run("cargo", ["build", "--release", "-p", "shadow-risc0-host"], { cwd: PACKAGE_ROOT, env });

  console.log("Installed successfully.");
  console.log("Next: node scripts/shadowcli.mjs --help");
}

function withToolchainPath(env) {
  const home = os.homedir();
  const cargoBin = path.join(home, ".cargo", "bin");
  const risc0Bin = path.join(home, ".risc0", "bin");
  const sep = process.platform === "win32" ? ";" : ":";
  const existing = env.PATH || "";
  return {
    ...env,
    PATH: `${cargoBin}${sep}${risc0Bin}${sep}${existing}`
  };
}

function ensureCmd(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: "ignore", ...opts });
  if (res.error || res.status !== 0) {
    throw new Error(
      `Missing required command: ${cmd}. ` +
        `Install it and re-run.\n` +
        `Tried: ${cmd} ${args.join(" ")}`
    );
  }
}

function hasCmd(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: "ignore", ...opts });
  return !res.error && res.status === 0;
}

function run(cmd, args, opts) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}
