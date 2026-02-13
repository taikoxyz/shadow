#!/usr/bin/env node

import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync } from "fs";
import { get } from "https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PTAU_DIR = join(__dirname, "..", "ptau");
const PTAU_URL_BASE = "https://storage.googleapis.com/zkevm/ptau";

const PTAU_FILES = {
  "powersOfTau28_hez_final_14.ptau": { constraints: "16k" },
  "powersOfTau28_hez_final_16.ptau": { constraints: "64k" },
  "powersOfTau28_hez_final_18.ptau": { constraints: "256k" },
  "powersOfTau28_hez_final_20.ptau": { constraints: "1M" },
  "powersOfTau28_hez_final_22.ptau": { constraints: "4M" },
  "powersOfTau28_hez_final_23.ptau": { constraints: "8M" },
  "powersOfTau28_hez_final_24.ptau": { constraints: "16M" },
  "powersOfTau28_hez_final_25.ptau": { constraints: "33M" },
  "powersOfTau28_hez_final_26.ptau": { constraints: "67M" },
  "powersOfTau28_hez_final_27.ptau": { constraints: "134M" },
  "powersOfTau28_hez_final.ptau": { constraints: "268M (2^28)" },
};

for (const [name, entry] of Object.entries(PTAU_FILES)) {
  entry.url = `${PTAU_URL_BASE}/${name}`;
}

// Default to 2^25 for larger circuits; override via PTAU_SIZE/PTAU_FILE/arg.
const DEFAULT_PTAU = "powersOfTau28_hez_final_25.ptau";
const MIN_VALID_PTAU_BYTES = 1024 * 1024;

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

function filePrefix(path, size = 32) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size);
    const bytesRead = readSync(fd, buf, 0, size, 0);
    return buf.toString("utf8", 0, bytesRead).trimStart();
  } finally {
    closeSync(fd);
  }
}

function looksLikeBrokenDownload(path) {
  const { size } = statSync(path);
  if (size < MIN_VALID_PTAU_BYTES) return true;
  const prefix = filePrefix(path).toLowerCase();
  return prefix.startsWith("<?xml") || prefix.startsWith("<error") || prefix.startsWith("<html");
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    const request = get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        unlinkSync(dest);
        reject(new Error(`HTTP ${response.statusCode} while downloading ${url}`));
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"], 10);
      let downloadedBytes = 0;

      response.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\rDownloading: ${percent}%`);
        } else {
          process.stdout.write(`\rDownloading: ${Math.floor(downloadedBytes / (1024 * 1024))} MiB`);
        }
      });

      response.pipe(file);

      file.on("finish", () => {
        file.close();
        console.log("\nDownload complete!");
        resolve();
      });
    });

    request.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  // Supports PTAU_SIZE=25, PTAU_FILE=... or an explicit filename arg.
  const requestedName = process.argv[2] || process.env.PTAU_FILE || process.env.PTAU_SIZE;
  const ptauName = resolvePtauName(requestedName);
  const ptauInfo = PTAU_FILES[ptauName];

  if (!ptauInfo) {
    console.error(`Unknown ptau file: ${ptauName}`);
    console.error("Available files:");
    for (const [name, info] of Object.entries(PTAU_FILES)) {
      console.error(`  ${name} (up to ${info.constraints} constraints)`);
    }
    process.exit(1);
  }

  if (!existsSync(PTAU_DIR)) {
    mkdirSync(PTAU_DIR, { recursive: true });
  }

  const destPath = join(PTAU_DIR, ptauName);

  if (existsSync(destPath)) {
    if (looksLikeBrokenDownload(destPath)) {
      console.warn(`Existing PTAU at ${destPath} looks invalid (too small or XML/HTML). Re-downloading...`);
      unlinkSync(destPath);
    } else {
      console.log(`PTAU file already exists: ${destPath}`);
      return;
    }
  }

  console.log(`Downloading ${ptauName} (supports up to ${ptauInfo.constraints} constraints)...`);
  console.log(`From: ${ptauInfo.url}`);

  await downloadFile(ptauInfo.url, destPath);
  console.log(`Saved to: ${destPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
