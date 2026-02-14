#!/usr/bin/env node

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import Ajv from "ajv";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const SCHEMA_PATH = path.join(WORKSPACE_ROOT, "packages", "docs", "data", "schema", "deposit.schema.json");

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1"
};

const MAX_NOTES = 5;
const MAX_PROOF_DEPTH = 64;
const MAX_NODE_BYTES = 4096;
const MAX_TOTAL_WEI = 32000000000000000000n;
const HOODI_CHAIN_ID = 167013n;
const HOODI_L1_CHAIN_ID = 560048n;
const HOODI_CHECKPOINT_STORE = "0x1670130000000000000000000000000000000005";
const HOODI_L1_RPC = "https://ethereum-hoodi-rpc.publicnode.com";
const DEFAULT_CHECKPOINT_LOOKBACK = 2048n;
const CHECKPOINT_NOT_FOUND_SELECTOR = "0xf297591c";

const IDX = {
  BLOCK_NUMBER: 0,
  STATE_ROOT: 1,
  CHAIN_ID: 33,
  AMOUNT: 34,
  RECIPIENT: 35,
  NULLIFIER: 55
};

const usage = `Usage:
  node scripts/shadowcli.mjs validate --deposit <DEPOSIT.json> [--rpc <url>] [--note-index <n>]
  node scripts/shadowcli.mjs prove --deposit <DEPOSIT.json> --rpc <url> [--l1-rpc <url>] [--checkpoint-store <address>] [--checkpoint-block <n>] [--checkpoint-lookback <n>] [--note-index <n>] [--proof-out <note-x.proof.json>] [--receipt-kind groth16|succinct|composite] [--keep-intermediate-files] [--verbose]
  node scripts/shadowcli.mjs verify --proof <note-x.proof.json> [--verifier <address|deployed_verifier.json> --rpc <url>] [--receipt <receipt.bin>] [--host-bin <path>]
  node scripts/shadowcli.mjs claim --proof <note-x.proof.json> --shadow <address> --rpc <url> --private-key <0x...>

Notes:
  - DEPOSIT file must conform to packages/docs/data/schema/deposit.schema.json
  - prove writes a self-contained note proof file with ABI-encoded proof payload
  - prove deletes intermediate files by default (claim input, receipt, journal, exported proof payload)
  - pass --verbose to stream host/docker logs
  - verify with --verifier performs on-chain view verification via verifyProof(bytes,uint256[])
  - verify without --verifier performs local receipt verification (uses --receipt or build/risc0/receipt.bin)
`;

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main() {
  const { command, opts } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "validate":
      await cmdValidate(opts);
      return;
    case "prove":
      await cmdProve(opts);
      return;
    case "verify":
    case "verify-onchain":
      await cmdVerify(opts);
      return;
    case "claim":
      await cmdClaim(opts);
      return;
    default:
      console.error(usage);
      process.exit(1);
  }
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { command: "help", opts: {} };
  }
  const command = argv[0];
  const opts = {};
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return { command, opts };
}

async function cmdValidate(opts) {
  const depositPath = requireOpt(opts, "deposit");
  const depositAbsPath = resolvePath(depositPath);
  const deposit = loadDeposit(depositPath);
  const chainId = resolveChainIdFromDeposit(deposit);
  if (opts.rpc) {
    const rpcChainId = await fetchChainId(opts.rpc);
    if (rpcChainId !== chainId) {
      throw new Error(`RPC chainId (${rpcChainId}) does not match deposit.chainId (${chainId})`);
    }
  }
  const noteIndex = resolveNoteIndex(opts["note-index"], deposit);
  const derived = deriveFromDeposit(deposit, chainId, noteIndex);

  console.log("DEPOSIT file:", depositAbsPath);
  console.log("Schema:", SCHEMA_PATH);
  console.log("Chain ID:", chainId.toString());
  console.log("Notes:", deposit.notes.length);
  console.log("Claim note index:", noteIndex);
  console.log("Claim amount:", derived.claimAmount.toString(), "wei");
  console.log("Total amount:", derived.totalAmount.toString(), "wei");
  console.log("Target address:", bytesToHex(derived.targetAddress));
  console.log("Nullifier:", bytesToHex(derived.nullifier));
  console.log("PoW digest:", bytesToHex(derived.powDigest));
  console.log("PoW digest valid:", powDigestIsValid(derived.powDigest));

  if (deposit.targetAddress) {
    const expected = getAddress(deposit.targetAddress);
    const actual = getAddress(bytesToHex(derived.targetAddress));
    if (expected !== actual) {
      throw new Error(`targetAddress mismatch: expected ${expected}, got ${actual}`);
    }
    console.log("targetAddress: matched");
  }
}

async function cmdProve(opts) {
  const depositPath = requireOpt(opts, "deposit");
  const depositAbsPath = resolvePath(depositPath);
  const depositProofPath = tryRelativizePath(depositAbsPath) || depositAbsPath;
  const rpcUrl = requireOpt(opts, "rpc");
  const deposit = loadDeposit(depositPath);

  const rpcChainId = await fetchChainId(rpcUrl);
  const chainId = resolveChainIdFromDeposit(deposit);
  if (chainId !== rpcChainId) {
    throw new Error(`RPC chainId (${rpcChainId}) does not match resolved chainId (${chainId})`);
  }

  const noteIndex = resolveNoteIndex(opts["note-index"], deposit);
  const receiptKind = opts["receipt-kind"] || "groth16";
  const keepIntermediateFiles = opts["keep-intermediate-files"] === true;
  const verbose = opts.verbose === true;
  const allowInsufficient = opts["allow-insufficient-balance"] === true;

  const derived = deriveFromDeposit(deposit, chainId, noteIndex);
  const targetAddressHex = bytesToHex(derived.targetAddress);
  console.log("Target address:", targetAddressHex);
  console.log("Total required:", derived.totalAmount.toString(), "wei");
  if (!powDigestIsValid(derived.powDigest)) {
    throw new Error(
      "PoW digest is not valid for this note set + secret (needs last 24 bits == 0). Use a valid secret before proving."
    );
  }

  let blockNumber;
  let stateRootBytes;
  let accountProof;
  let accountBalance;

  const useCheckpointMode =
    opts["l1-rpc"] !== undefined ||
    opts["checkpoint-store"] !== undefined ||
    chainId === HOODI_CHAIN_ID;

  if (useCheckpointMode) {
    const l1RpcUrl = resolveL1RpcUrl(opts["l1-rpc"], chainId);
    const l1ChainId = await fetchChainId(l1RpcUrl);
    if (chainId === HOODI_CHAIN_ID && l1ChainId !== HOODI_L1_CHAIN_ID) {
      throw new Error(`L1 RPC chainId (${l1ChainId}) does not match Hoodi L1 (${HOODI_L1_CHAIN_ID})`);
    }

    const checkpointStoreAddress = resolveCheckpointStoreAddress(opts["checkpoint-store"], chainId);
    const checkpointStoreProvider = new JsonRpcProvider(rpcUrl);
    const checkpointStore = new Contract(
      checkpointStoreAddress,
      [
        "function getCheckpoint(uint48 _blockNumber) view returns ((uint48 blockNumber, bytes32 blockHash, bytes32 stateRoot))"
      ],
      checkpointStoreProvider
    );

    const checkpointBlockOpt = opts["checkpoint-block"];
    let checkpoint;
    if (checkpointBlockOpt !== undefined) {
      const checkpointBlock = parseDec(checkpointBlockOpt, "checkpoint-block");
      checkpoint = await getCheckpointOrThrow(checkpointStore, checkpointBlock);
    } else {
      const l1LatestBlock = parseRpcNumber(await rpcCall(l1RpcUrl, "eth_blockNumber", []));
      const checkpointLookback = parseOptionalDec(
        opts["checkpoint-lookback"],
        "checkpoint-lookback",
        DEFAULT_CHECKPOINT_LOOKBACK
      );
      checkpoint = await findLatestCheckpoint(checkpointStore, l1LatestBlock, checkpointLookback);
    }

    blockNumber = checkpoint.blockNumber;
    stateRootBytes = hexToBytes(checkpoint.stateRoot);

    const l1Block = await rpcCall(l1RpcUrl, "eth_getBlockByNumber", [toRpcQuantity(blockNumber), false]);
    if (!l1Block) {
      throw new Error(`L1 block not found at checkpoint block ${blockNumber}`);
    }
    if (
      l1Block.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase() ||
      l1Block.stateRoot.toLowerCase() !== checkpoint.stateRoot.toLowerCase()
    ) {
      throw new Error(
        `checkpoint mismatch at block ${blockNumber}: checkpoint (${checkpoint.blockHash}, ${checkpoint.stateRoot}) vs L1 block (${l1Block.hash}, ${l1Block.stateRoot})`
      );
    }

    accountProof = await rpcCall(l1RpcUrl, "eth_getProof", [targetAddressHex, [], toRpcQuantity(blockNumber)]);
    accountBalance = parseRpcBigInt(accountProof.balance);

    console.log("Checkpoint store:", checkpointStoreAddress);
    console.log("L1 RPC:", l1RpcUrl);
    console.log("L1 chain ID:", l1ChainId.toString());
    console.log("Proof block:", blockNumber.toString(), "(checkpoint block)");
  } else {
    const block = await rpcCall(rpcUrl, "eth_getBlockByNumber", ["latest", false]);
    blockNumber = parseRpcNumber(block.number);
    stateRootBytes = hexToBytes(block.stateRoot);
    accountProof = await rpcCall(rpcUrl, "eth_getProof", [targetAddressHex, [], block.number]);
    accountBalance = parseRpcBigInt(accountProof.balance);
    console.log("Proof block:", blockNumber.toString());
  }

  console.log("Account balance:", accountBalance.toString(), "wei");
  if (accountBalance < derived.totalAmount && !allowInsufficient) {
    throw new Error(
      `insufficient balance: ${accountBalance} < ${derived.totalAmount}; fund target address first or pass --allow-insufficient-balance`
    );
  }

  const claimInput = buildLegacyClaimInput({
    blockNumber,
    stateRootBytes,
    chainId,
    noteIndex,
    claimAmount: derived.claimAmount,
    recipientBytes: derived.claimRecipientBytes,
    secretBytes: derived.secretBytes,
    noteCount: deposit.notes.length,
    amounts: derived.noteAmounts,
    recipientHashes: derived.recipientHashes,
    accountProofNodes: accountProof.accountProof,
    accountBalance
  });

  const buildDir = path.join(PACKAGE_ROOT, "build", "risc0");
  fs.mkdirSync(buildDir, { recursive: true });

  const inputOut = resolvePath(
    opts["input-out"] || path.join(buildDir, `claim-input-note-${noteIndex}.json`)
  );
  const receiptOut = resolvePath(opts["receipt-out"] || path.join(buildDir, "receipt.bin"));
  const journalOut = resolvePath(opts["journal-out"] || path.join(buildDir, "journal.json"));
  const exportedProofOut = resolvePath(opts["exported-proof-out"] || path.join(buildDir, "proof-export.json"));
  const proofOut = resolvePath(
    opts["proof-out"] || path.join(path.dirname(depositAbsPath), `note-${noteIndex}.proof.json`)
  );
  const hostBin = resolveHostBin(opts["host-bin"], receiptKind);
  if (verbose) {
    console.log("Host binary:", hostBin);
    console.log("Receipt kind:", receiptKind);
  }

  fs.writeFileSync(inputOut, JSON.stringify(claimInput, null, 2));

  console.log("Running prover...");
  runHost(hostBin, [
    "prove",
    "--input",
    inputOut,
    "--receipt",
    receiptOut,
    "--journal",
    journalOut,
    "--receipt-kind",
    receiptKind
  ], { quiet: !verbose });

  runHost(hostBin, ["export-proof", "--receipt", receiptOut, "--out", exportedProofOut], {
    quiet: !verbose
  });
  const exported = loadJson(exportedProofOut);
  const proof = AbiCoder.defaultAbiCoder().encode(["bytes", "bytes"], [exported.seal_hex, exported.journal_hex]);
  const receiptBase64 = fs.readFileSync(receiptOut).toString("base64");

  const publicInputs = buildPublicInputs({
    blockNumber,
    stateRootBytes,
    chainId,
    claimAmount: derived.claimAmount,
    recipientBytes: derived.claimRecipientBytes,
    nullifierBytes: derived.nullifier
  });

  const noteProof = {
    version: "v2",
    depositFile: depositProofPath,
    blockNumber: blockNumber.toString(),
    chainId: chainId.toString(),
    noteIndex: String(noteIndex),
    amount: derived.claimAmount.toString(),
    recipient: bytesToHex(derived.claimRecipientBytes),
    nullifier: bytesToHex(derived.nullifier),
    publicInputs: publicInputs.map((x) => x.toString()),
    risc0: {
      proof,
      receipt: receiptBase64
    }
  };

  fs.writeFileSync(proofOut, JSON.stringify(noteProof, null, 2));
  console.log("Note proof file:", proofOut);

  if (!keepIntermediateFiles) {
    cleanupFiles([inputOut, receiptOut, journalOut, exportedProofOut]);
  }
}

function tryRelativizePath(absPath) {
  try {
    const rel = path.relative(WORKSPACE_ROOT, absPath);
    if (!rel || rel.startsWith("..")) return null;
    return rel;
  } catch {
    return null;
  }
}

async function cmdVerify(opts) {
  const proofPath = requireOpt(opts, "proof");
  const noteProof = loadJson(proofPath);
  const { proof, publicInputs } = extractVerificationPayload(noteProof, proofPath);

  const verifierInput = opts["verifier"];
  if (!verifierInput) {
    return cmdVerifyOffchain(opts, noteProof, proofPath);
  }

  const rpcUrl = requireOpt(opts, "rpc");
  const verifierAddress = resolveVerifierAddress(verifierInput);

  const provider = new JsonRpcProvider(rpcUrl);
  const verifier = new Contract(
    verifierAddress,
    ["function verifyProof(bytes _proof, uint256[] _publicInputs) view returns (bool)"],
    provider
  );

  const publicInputsBig = publicInputs.map((x) => BigInt(x));
  let isValid;
  try {
    isValid = await verifier.verifyProof(proof, publicInputsBig);
  } catch (err) {
    throw new Error(`on-chain verifyProof call failed: ${formatErr(err)}`);
  }

  console.log("Verifier:", verifierAddress);
  console.log("Proof file:", resolvePath(proofPath));
  console.log("Verification mode: on-chain");
  console.log("verifyProof result:", Boolean(isValid));
}

async function cmdClaim(opts) {
  const proofPath = requireOpt(opts, "proof");
  const shadowAddressRaw = requireOpt(opts, "shadow");
  const rpcUrl = requireOpt(opts, "rpc");
  const privateKey = requireOpt(opts, "private-key");

  if (!isAddress(shadowAddressRaw)) {
    throw new Error(`invalid --shadow address: ${shadowAddressRaw}`);
  }
  const shadowAddress = getAddress(shadowAddressRaw);

  const noteProof = loadJson(proofPath);
  const { proof } = extractVerificationPayload(noteProof, proofPath);

  const input = [
    BigInt(noteProof.blockNumber),
    BigInt(noteProof.chainId),
    BigInt(noteProof.amount),
    getAddress(noteProof.recipient),
    noteProof.nullifier
  ];

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const shadow = new Contract(
    shadowAddress,
    [
      "function isConsumed(bytes32 _nullifier) view returns (bool)",
      "function claim(bytes _proof, (uint48 blockNumber, uint256 chainId, uint256 amount, address recipient, bytes32 nullifier) _input)"
    ],
    wallet
  );

  const consumed = await shadow.isConsumed(noteProof.nullifier);
  if (consumed) {
    throw new Error(`nullifier already consumed: ${noteProof.nullifier}`);
  }

  const tx = await shadow.claim(proof, input);
  console.log("Shadow:", shadowAddress);
  console.log("Proof file:", resolvePath(proofPath));
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("status: confirmed");
}

function cmdVerifyOffchain(opts, noteProof, proofPath) {
  const hostBin = resolvePath(
    opts["host-bin"] || path.join(PACKAGE_ROOT, "target", "release", "shadow-risc0-host")
  );
  let receiptPath = resolveOffchainReceiptPath(opts["receipt"], noteProof);
  let tempReceiptPath = null;
  if (!receiptPath) {
    tempReceiptPath = materializeEmbeddedReceipt(noteProof);
    receiptPath = tempReceiptPath;
  }
  if (!receiptPath) {
    throw new Error(
      "off-chain verify requires --receipt <receipt.bin>, embedded risc0.receipt in proof file, or build/risc0/receipt.bin; or pass --verifier with --rpc"
    );
  }
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`receipt file not found: ${receiptPath}`);
  }

  try {
    runHost(hostBin, ["verify", "--receipt", receiptPath], { quiet: true });
    console.log("Proof file:", resolvePath(proofPath));
    console.log("Verification mode: off-chain");
    console.log("verify result: true");
  } finally {
    if (tempReceiptPath) {
      cleanupFiles([tempReceiptPath]);
    }
  }
}

function resolveOffchainReceiptPath(cliReceipt, noteProof) {
  if (cliReceipt) {
    return resolvePath(cliReceipt);
  }
  if (noteProof && typeof noteProof.receiptFile === "string" && noteProof.receiptFile.length > 0) {
    return resolvePath(noteProof.receiptFile);
  }
  const defaultReceipt = resolvePath(path.join(PACKAGE_ROOT, "build", "risc0", "receipt.bin"));
  if (fs.existsSync(defaultReceipt)) {
    return defaultReceipt;
  }
  return null;
}

function materializeEmbeddedReceipt(noteProof) {
  if (!noteProof || typeof noteProof !== "object") return null;
  const encoded = noteProof?.risc0?.receipt;
  if (typeof encoded !== "string" || encoded.length === 0) {
    return null;
  }

  const buildDir = resolvePath(path.join(PACKAGE_ROOT, "build", "risc0"));
  fs.mkdirSync(buildDir, { recursive: true });
  const tmpPath = path.join(buildDir, `receipt-from-proof-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(tmpPath, decodeBinaryPayload(encoded));
  return tmpPath;
}

function extractVerificationPayload(noteProof, proofPath) {
  // Backward compatibility: accept both legacy formats and v1 with top-level publicInputs.
  if (
    noteProof &&
    noteProof.risc0 &&
    typeof noteProof.risc0 === "object" &&
    typeof noteProof.risc0.proof === "string" &&
    Array.isArray(noteProof.publicInputs)
  ) {
    return {
      proof: noteProof.risc0.proof,
      publicInputs: noteProof.publicInputs
    };
  }
  if (noteProof && noteProof.risc0 && typeof noteProof.risc0 === "object") {
    if (typeof noteProof.risc0.proof === "string" && Array.isArray(noteProof.risc0.publicInputs)) {
      return {
        proof: noteProof.risc0.proof,
        publicInputs: noteProof.risc0.publicInputs
      };
    }
    if (typeof noteProof.risc0.proofHex === "string" && Array.isArray(noteProof.risc0.publicInputs)) {
      return {
        proof: noteProof.risc0.proofHex,
        publicInputs: noteProof.risc0.publicInputs
      };
    }
  }
  if (typeof noteProof?.proofHex === "string" && Array.isArray(noteProof?.publicInputs)) {
    return {
      proof: noteProof.proofHex,
      publicInputs: noteProof.publicInputs
    };
  }
  throw new Error(`invalid proof file format: ${proofPath}`);
}

function loadDeposit(depositPath) {
  const deposit = loadJson(depositPath);
  const schema = loadJson(SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(deposit)) {
    const message = (validate.errors || [])
      .map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`DEPOSIT schema validation failed: ${message}`);
  }
  return deposit;
}

function resolveChainIdFromDeposit(deposit) {
  return parseDec(deposit.chainId, "deposit.chainId");
}

async function fetchChainId(rpcUrl) {
  const chainIdHex = await rpcCall(rpcUrl, "eth_chainId", []);
  return parseRpcBigInt(chainIdHex);
}

function resolveNoteIndex(cliNoteIndex, deposit) {
  if (cliNoteIndex !== undefined) {
    return Number(parseDec(cliNoteIndex, "note-index"));
  }
  return 0;
}

function deriveFromDeposit(deposit, chainId, noteIndex) {
  if (noteIndex < 0 || noteIndex >= deposit.notes.length) {
    throw new Error(`noteIndex out of range: ${noteIndex}`);
  }

  const secretBytes = hexToBytes(deposit.secret);
  if (secretBytes.length !== 32) {
    throw new Error("secret must be 32 bytes");
  }

  const noteAmounts = [];
  const recipientHashes = [];
  const recipients = [];
  let totalAmount = 0n;

  for (let i = 0; i < deposit.notes.length; i++) {
    const amount = parseDec(deposit.notes[i].amount, `notes[${i}].amount`);
    if (amount <= 0n) {
      throw new Error(`notes[${i}].amount must be > 0`);
    }
    noteAmounts.push(amount);
    totalAmount += amount;

    const recipient = getAddress(deposit.notes[i].recipient);
    const recipientBytes = hexToBytes(recipient);
    recipients.push(recipientBytes);
    recipientHashes.push(computeRecipientHash(recipientBytes));
  }

  if (totalAmount > MAX_TOTAL_WEI) {
    throw new Error(`total amount exceeds protocol max (${MAX_TOTAL_WEI.toString()} wei)`);
  }

  const notesHash = computeNotesHash(noteAmounts, recipientHashes);
  const targetAddress = deriveTargetAddress(secretBytes, chainId, notesHash);
  const nullifier = deriveNullifier(secretBytes, chainId, noteIndex);
  const powDigest = computePowDigest(notesHash, secretBytes);

  return {
    secretBytes,
    noteAmounts,
    recipientHashes,
    notesHash,
    totalAmount,
    claimAmount: noteAmounts[noteIndex],
    claimRecipientBytes: recipients[noteIndex],
    targetAddress,
    nullifier,
    powDigest
  };
}

function buildLegacyClaimInput({
  blockNumber,
  stateRootBytes,
  chainId,
  noteIndex,
  claimAmount,
  recipientBytes,
  secretBytes,
  noteCount,
  amounts,
  recipientHashes,
  accountProofNodes,
  accountBalance
}) {
  if (!Array.isArray(accountProofNodes) || accountProofNodes.length === 0) {
    throw new Error("eth_getProof accountProof is empty");
  }
  if (accountProofNodes.length > MAX_PROOF_DEPTH) {
    throw new Error(`accountProof depth exceeds MAX_PROOF_DEPTH (${MAX_PROOF_DEPTH})`);
  }

  const paddedProofNodes = accountProofNodes.map((nodeHex, idx) => {
    const node = hexToBytes(nodeHex);
    if (node.length > MAX_NODE_BYTES) {
      throw new Error(`accountProof node ${idx} exceeds MAX_NODE_BYTES (${MAX_NODE_BYTES})`);
    }
    const row = new Array(MAX_NODE_BYTES).fill("0");
    for (let i = 0; i < node.length; i++) {
      row[i] = String(node[i]);
    }
    return row;
  });
  while (paddedProofNodes.length < MAX_PROOF_DEPTH) {
    paddedProofNodes.push(new Array(MAX_NODE_BYTES).fill("0"));
  }

  const proofNodeLengths = accountProofNodes.map((nodeHex) => String(hexToBytes(nodeHex).length));
  while (proofNodeLengths.length < MAX_PROOF_DEPTH) {
    proofNodeLengths.push("0");
  }

  const amountsPadded = amounts.map((x) => x.toString());
  while (amountsPadded.length < MAX_NOTES) {
    amountsPadded.push("0");
  }

  const recipientHashesPadded = recipientHashes.map((hash) => bytesToDecStrings(hash));
  while (recipientHashesPadded.length < MAX_NOTES) {
    recipientHashesPadded.push(new Array(32).fill("0"));
  }

  return {
    blockNumber: blockNumber.toString(),
    stateRoot: bytesToDecStrings(stateRootBytes),
    chainId: chainId.toString(),
    noteIndex: String(noteIndex),
    amount: claimAmount.toString(),
    recipient: bytesToDecStrings(recipientBytes),
    secret: bytesToDecStrings(secretBytes),
    noteCount: String(noteCount),
    amounts: amountsPadded,
    recipientHashes: recipientHashesPadded,
    proofNodes: paddedProofNodes,
    proofNodeLengths,
    proofDepth: String(accountProofNodes.length),
    accountBalance: accountBalance.toString()
  };
}

function buildPublicInputs({
  blockNumber,
  stateRootBytes,
  chainId,
  claimAmount,
  recipientBytes,
  nullifierBytes
}) {
  const out = new Array(87).fill(0n);
  out[IDX.BLOCK_NUMBER] = blockNumber;
  writeBytes(out, IDX.STATE_ROOT, stateRootBytes);
  out[IDX.CHAIN_ID] = chainId;
  out[IDX.AMOUNT] = claimAmount;
  writeBytes(out, IDX.RECIPIENT, recipientBytes);
  writeBytes(out, IDX.NULLIFIER, nullifierBytes);
  return out;
}

function writeBytes(target, offset, bytes) {
  for (let i = 0; i < bytes.length; i++) {
    target[offset + i] = BigInt(bytes[i]);
  }
}

function computeRecipientHash(recipientBytes) {
  if (recipientBytes.length !== 20) {
    throw new Error("recipient must be 20 bytes");
  }
  const magic = padMagicLabel(MAGIC.RECIPIENT);
  const paddedRecipient = new Uint8Array(32);
  paddedRecipient.set(recipientBytes, 12);

  const input = new Uint8Array(64);
  input.set(magic, 0);
  input.set(paddedRecipient, 32);
  return sha256(input);
}

function computeNotesHash(amounts, recipientHashes) {
  const buf = new Uint8Array(MAX_NOTES * 64);
  for (let i = 0; i < amounts.length; i++) {
    buf.set(bigintToBytes32(amounts[i]), i * 64);
    buf.set(recipientHashes[i], i * 64 + 32);
  }
  return sha256(buf);
}

function deriveTargetAddress(secretBytes, chainId, notesHash) {
  const input = new Uint8Array(128);
  input.set(padMagicLabel(MAGIC.ADDRESS), 0);
  input.set(bigintToBytes32(chainId), 32);
  input.set(secretBytes, 64);
  input.set(notesHash, 96);
  const hash = sha256(input);
  return hash.slice(12);
}

function deriveNullifier(secretBytes, chainId, noteIndex) {
  const input = new Uint8Array(128);
  input.set(padMagicLabel(MAGIC.NULLIFIER), 0);
  input.set(bigintToBytes32(chainId), 32);
  input.set(secretBytes, 64);
  input.set(bigintToBytes32(BigInt(noteIndex)), 96);
  return sha256(input);
}

function computePowDigest(notesHash, secretBytes) {
  const input = new Uint8Array(64);
  input.set(notesHash, 0);
  input.set(secretBytes, 32);
  return sha256(input);
}

function powDigestIsValid(digest) {
  return digest[29] === 0 && digest[30] === 0 && digest[31] === 0;
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} failed with status ${res.status}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`RPC ${method} error: ${body.error.message || "unknown"}`);
  }
  return body.result;
}

function runHost(hostBin, args, options = {}) {
  if (!fs.existsSync(hostBin)) {
    throw new Error(`host binary not found: ${hostBin} (run: cargo build --release -p shadow-risc0-host)`);
  }
  const quiet = options.quiet === true;
  const result = spawnSync(hostBin, args, {
    cwd: PACKAGE_ROOT,
    stdio: quiet ? "pipe" : "inherit",
    env: process.env,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const output = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
    const needsDocker =
      args.includes("--receipt-kind") &&
      args.includes("groth16") &&
      (output.includes("Please install docker first.") || output.includes("docker returned failure exit code"));
    const dockerHint = needsDocker
      ? `\nHint: Groth16 receipts require Docker (risc0-groth16 shrinkwrap). Ensure Docker is installed and running, then retry.`
      : "";
    const suffix = output ? `\n${output}` : "";
    throw new Error(`host command failed: ${hostBin} ${args.join(" ")}${suffix}${dockerHint}`);
  }
  return result;
}

function resolveHostBin(explicitHostBin, receiptKind) {
  if (explicitHostBin) {
    return resolvePath(explicitHostBin);
  }

  const defaultHost = path.join(PACKAGE_ROOT, "target", "release", "shadow-risc0-host");
  return resolvePath(defaultHost);
}

function resolveVerifierAddress(value) {
  if (isAddress(value)) {
    return getAddress(value);
  }
  const json = loadJson(value);
  const found = findVerifierAddress(json);
  if (!found) {
    throw new Error(`could not find verifier address in file: ${value}`);
  }
  return getAddress(found);
}

function findVerifierAddress(obj) {
  if (!obj || typeof obj !== "object") return null;

  const directKeys = ["verifier", "verifierAddress", "address", "contractAddress", "deployedTo"];
  for (const key of directKeys) {
    if (typeof obj[key] === "string" && isAddress(obj[key])) {
      return obj[key];
    }
  }

  if (Array.isArray(obj.transactions)) {
    for (let i = obj.transactions.length - 1; i >= 0; i--) {
      const tx = obj.transactions[i];
      if (tx && typeof tx.contractAddress === "string" && isAddress(tx.contractAddress)) {
        return tx.contractAddress;
      }
    }
  }

  return null;
}

function requireOpt(opts, key) {
  const value = opts[key];
  if (!value) {
    throw new Error(`missing required --${key}`);
  }
  return value;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(resolvePath(filePath), "utf8"));
}

function resolvePath(p) {
  if (path.isAbsolute(p)) {
    return p;
  }
  if (p.startsWith("packages/")) {
    return path.join(WORKSPACE_ROOT, p);
  }
  const fromCwd = path.resolve(p);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  const fromWorkspace = path.join(WORKSPACE_ROOT, p);
  if (fs.existsSync(fromWorkspace)) {
    return fromWorkspace;
  }
  return fromCwd;
}

function cleanupFiles(paths) {
  for (const filePath of paths) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
  }
}

function parseDec(value, fieldName) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be a base-10 integer string`);
  }
  return BigInt(value);
}

function parseRpcNumber(value) {
  if (typeof value === "string" && value.startsWith("0x")) {
    return BigInt(value);
  }
  return parseDec(String(value), "blockNumber");
}

function parseRpcBigInt(value) {
  if (typeof value === "string" && value.startsWith("0x")) {
    return BigInt(value);
  }
  return parseDec(String(value), "rpc bigint");
}

function parseOptionalDec(value, fieldName, defaultValue) {
  if (value === undefined || value === true) {
    return defaultValue;
  }
  return parseDec(String(value), fieldName);
}

function hexToBytes(hex) {
  const clean = stripHexPrefix(hex);
  if (clean.length % 2 !== 0) {
    throw new Error(`invalid hex length: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

function bytesToDecStrings(bytes) {
  return Array.from(bytes).map((b) => String(b));
}

function stripHexPrefix(hex) {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function decodeBinaryPayload(value) {
  if (value.startsWith("0x")) {
    const clean = stripHexPrefix(value);
    if (clean.length % 2 !== 0) {
      throw new Error("invalid hex payload length");
    }
    return Buffer.from(clean, "hex");
  }
  return Buffer.from(value, "base64");
}

function padMagicLabel(label) {
  const labelBytes = new TextEncoder().encode(label);
  const out = new Uint8Array(32);
  out.set(labelBytes.slice(0, 32));
  return out;
}

function bigintToBytes32(value) {
  if (value < 0n) {
    throw new Error("negative values are not supported");
  }
  const hex = value.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function sha256(bytes) {
  const hash = createHash("sha256");
  hash.update(bytes);
  return new Uint8Array(hash.digest());
}

function formatErr(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function toRpcQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function resolveL1RpcUrl(cliL1Rpc, chainId) {
  if (cliL1Rpc) {
    return cliL1Rpc;
  }
  if (chainId === HOODI_CHAIN_ID) {
    return HOODI_L1_RPC;
  }
  throw new Error("missing required --l1-rpc for checkpoint mode");
}

function resolveCheckpointStoreAddress(cliCheckpointStore, chainId) {
  if (cliCheckpointStore) {
    if (!isAddress(cliCheckpointStore)) {
      throw new Error(`invalid --checkpoint-store address: ${cliCheckpointStore}`);
    }
    return getAddress(cliCheckpointStore);
  }
  if (chainId === HOODI_CHAIN_ID) {
    return HOODI_CHECKPOINT_STORE;
  }
  throw new Error("missing required --checkpoint-store for checkpoint mode");
}

function extractErrorData(err) {
  return err?.data || err?.info?.error?.data || err?.error?.data || "";
}

async function tryGetCheckpoint(checkpointStore, blockNumber) {
  try {
    const checkpoint = await checkpointStore.getCheckpoint(blockNumber);
    return {
      blockNumber: BigInt(checkpoint.blockNumber),
      blockHash: checkpoint.blockHash,
      stateRoot: checkpoint.stateRoot
    };
  } catch (err) {
    const data = String(extractErrorData(err)).toLowerCase();
    if (data.startsWith(CHECKPOINT_NOT_FOUND_SELECTOR)) {
      return null;
    }
    throw new Error(`checkpoint query failed at block ${blockNumber}: ${formatErr(err)}`);
  }
}

async function getCheckpointOrThrow(checkpointStore, blockNumber) {
  const checkpoint = await tryGetCheckpoint(checkpointStore, blockNumber);
  if (!checkpoint) {
    throw new Error(`checkpoint not found at block ${blockNumber}`);
  }
  return checkpoint;
}

async function findLatestCheckpoint(checkpointStore, latestBlock, lookback) {
  if (latestBlock <= 0n) {
    throw new Error(`invalid latest L1 block number: ${latestBlock}`);
  }
  const minBlock = latestBlock > lookback ? latestBlock - lookback : 1n;
  for (let block = latestBlock; block >= minBlock; block -= 1n) {
    const checkpoint = await tryGetCheckpoint(checkpointStore, block);
    if (checkpoint) {
      return checkpoint;
    }
  }
  throw new Error(
    `no checkpoint found in range [${minBlock.toString()}, ${latestBlock.toString()}] (lookback ${lookback.toString()})`
  );
}
