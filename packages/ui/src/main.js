import {
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  fromHex,
  getAddress,
  isAddress,
  parseEther
} from "viem";
import { sha256 as sha256Sync } from "@noble/hashes/sha256";
import "./style.css";

const MAGIC = {
  RECIPIENT: "shadow.recipient.v1",
  ADDRESS: "shadow.address.v1",
  NULLIFIER: "shadow.nullifier.v1"
};

// Must match the proving system + deposit schema (Shadow supports 1..5 notes).
const MAX_NOTES = 5;
const MAX_TOTAL_WEI = 32000000000000000000n;
const HOODI_MAX_TX_SIZE_BYTES = 131072;
// Default Shadow proxy address for Taiko Hoodi (deployed 2026-02-24, commit 38d8ca1)
const DEFAULT_SHADOW_ADDRESS = "0x77cdA0575e66A5FC95404fdA856615AD507d8A07";
const PUBLIC_INPUTS_LEN = 87;
const PUBLIC_INPUT_IDX = {
  BLOCK_NUMBER: 0,
  BLOCK_HASH: 1,  // Changed from STATE_ROOT - circuit now commits blockHash
  CHAIN_ID: 33,
  AMOUNT: 34,
  RECIPIENT: 35,
  NULLIFIER: 55
};
const encoder = new TextEncoder();
const HOODI_CHAIN_ID = 167013n;
const HOODI_CHAIN_HEX = "0x28c65";
const HOODI_RPC_HOST = "rpc.hoodi.taiko.xyz";
const HOODI_RPC_URL = `https://${HOODI_RPC_HOST}`;
const HOODI_CHAIN_PARAMS = {
  chainId: HOODI_CHAIN_HEX,
  chainName: "Taiko Hoodi",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: [HOODI_RPC_URL],
  blockExplorerUrls: ["https://hoodi.taikoscan.io"]
};


const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <header>
      <p class="eyebrow">Shadow</p>
      <h1>Deposit, Prove, Claim</h1>
      <p class="sub">Minimal local-first UI for DEPOSIT file generation, prove command prep, and claim tx submission.</p>
      <div class="wallet-bar">
        <button id="wallet-connect" type="button">Connect Wallet</button>
        <button id="wallet-switch-network" class="hidden" type="button">Switch to Taiko Hoodi (167013)</button>
        <p id="wallet-status" class="wallet-status">Wallet: not connected</p>
      </div>
    </header>

    <nav class="tabs" aria-label="Main tabs">
      <button class="tab is-active" data-tab="deposit" type="button">Deposit</button>
      <button class="tab" data-tab="prove" type="button">Prove</button>
      <button class="tab" data-tab="claim" type="button">Claim</button>
    </nav>

    <section class="panel is-active" id="tab-deposit">
      <h2>Notes</h2>
      <div class="note-label-row" aria-hidden="true">
        <span>Recipient</span>
        <span>Amount (ETH)</span>
        <span>Label</span>
        <span></span>
      </div>
      <div id="deposit-note-list"></div>
      <div class="note-controls-row">
        <button id="deposit-add-note" class="note-action" type="button" aria-label="Add note" title="Add note">+</button>
      </div>

      <div id="deposit-generate-row" class="cta-row">
        <button id="deposit-download" type="button">Generate Deposit File</button>
        <button id="deposit-start-over" type="button" class="secondary">Start Over</button>
      </div>

      <section id="deposit-generated" class="generated hidden">
        <h2>Summary</h2>
        <div class="generated-grid">
          <p><strong>Target</strong><span id="deposit-generated-target"></span></p>
          <p><strong>Total</strong><span id="deposit-generated-total"></span></p>
          <p><strong>File</strong><span id="deposit-generated-path"></span></p>
        </div>
      </section>
      <div id="deposit-generated-actions" class="generated-actions hidden">
        <div class="cta-row">
          <button id="deposit-save" type="button">Save Deposit File</button>
          <button id="deposit-send-ether" type="button" disabled>Deposit Ether</button>
        </div>
        <div class="tx-row">
          <a id="deposit-tx-link" class="tx-link hidden" href="#" target="_blank" rel="noopener noreferrer">View transaction</a>
          <span id="deposit-tx-status" class="tx-status"></span>
        </div>
      </div>

      <pre id="deposit-output" class="output hidden"></pre>
    </section>

    <section class="panel" id="tab-prove">
      <div id="prove-recent-deposit" class="recent-deposit hidden">
        <p>Recent deposit files:</p>
        <div id="prove-recent-list" class="recent-deposit-list"></div>
      </div>

      <div id="prove-drop-zone" class="drop-zone" role="button" tabindex="0">
        Drop DEPOSIT file here or click to choose
      </div>
      <input id="prove-file-input" type="file" accept="application/json,.json" hidden />
      <section id="prove-loaded-summary" class="generated hidden">
        <h2>Summary</h2>
        <div class="generated-grid">
          <p><strong>Target</strong><span id="prove-summary-target"></span></p>
          <p><strong>Total</strong><span id="prove-summary-total"></span></p>
          <p><strong>File</strong><span id="prove-summary-path"></span></p>
        </div>
      </section>

      <div id="prove-note-select-wrap" class="hidden">
        <h2>Unclaimed Notes</h2>
        <div id="prove-note-list"></div>
      </div>
      <section id="prove-command-wrap" class="generated hidden">
        <div class="command-head">
          <h2>Generate Proofs (Docker)</h2>
          <button id="prove-command-copy" class="link-btn tiny-btn" type="button">Copy</button>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="prove-platform-emulation" checked />
          <span>Platform emulation (required for Apple Silicon / ARM)</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="prove-verbose-output" />
          <span>Verbose output (show detailed proof generation logs)</span>
        </label>
        <pre id="prove-command" class="output command-output"></pre>
      </section>

      <pre id="prove-output" class="output"></pre>
      <div id="prove-check-again-wrap" class="cta-row hidden">
        <button id="prove-check-again" type="button" class="secondary">Check Again</button>
      </div>
    </section>

    <section class="panel" id="tab-claim">
      <div id="claim-drop-zone" class="drop-zone" role="button" tabindex="0">
        Drop proof file here or click to choose
      </div>
      <input id="claim-file-input" type="file" accept="application/json,.json,.proof" hidden />

      <div class="paste-section">
        <p class="paste-label">Or paste proof JSON:</p>
        <textarea id="claim-paste-input" rows="4" placeholder='{"version":"1.0","phase":"groth16",...}'></textarea>
        <button id="claim-parse-paste" type="button" class="secondary">Parse Pasted JSON</button>
      </div>

      <div id="claim-proof-selector" class="proof-selector hidden">
        <p class="selector-label">Select proof to claim:</p>
        <div id="claim-proof-list" class="proof-list"></div>
      </div>

      <div class="cta-row">
        <button id="claim-connect" type="button">Connect Wallet</button>
        <button id="claim-submit" type="button" disabled>Claim</button>
      </div>

      <pre id="claim-output" class="output"></pre>
    </section>

    <footer class="app-footer">
      <div class="footer-info">
        <p>RPC: <span id="footer-rpc">${HOODI_RPC_HOST}</span></p>
        <p>Shadow: <span id="footer-shadow">${DEFAULT_SHADOW_ADDRESS || "(not set)"}</span></p>
      </div>
      <button id="footer-settings" type="button" class="link-btn">Settings</button>
    </footer>

    <dialog id="settings-dialog">
      <h2>Settings</h2>
      <label>
        RPC URL
        <input id="settings-rpc" type="text" value="${HOODI_RPC_HOST}" placeholder="${HOODI_RPC_HOST}" />
      </label>
      <div class="cta-row">
        <button id="settings-save" type="button">Save</button>
        <button id="settings-cancel" type="button" class="secondary">Cancel</button>
      </div>
    </dialog>
  </main>
`;

const state = {
  settings: {
    rpcUrl: HOODI_RPC_URL
  },
  wallet: {
    account: "",
    chainId: null
  },
  deposit: {
    chainId: HOODI_CHAIN_ID.toString(),
    isGenerating: false,
    abortController: null,
    generated: null,
    fileSaved: false,
    savedFilePath: "",
    tx: null,
    nextNoteId: 1,
    notes: [newNote(0)]
  },
  prove: {
    depositFileName: "",
    depositFilePath: "",
    depositJson: null,
    loadedSummary: null,
    commandText: "",
    validationStamp: "",
    resolvedChainId: null,
    targetAddress: "",
    totalAmount: 0n,
    noteStatuses: [],
    selectedNoteIndex: null,
    sufficientBalance: false,
    platformEmulation: true,
    verboseOutput: false
  },
  claim: {
    account: "",
    proofJson: null,
    proofPayload: null,
    proofFileName: "",
    multiProofFile: null,
    selectedProofIndex: null
  }
};

bindTabs();
bindWallet();
bindDeposit();
bindProve();
bindClaim();
bindSettings();
loadSettingsFromStorage();
loadDepositFromStorage();
renderDepositNotes();
renderDepositGenerated();
renderProveLoadedSummary();
renderProveCommand();

function bindTabs() {
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("is-active"));
      tab.classList.add("is-active");

      const panels = [...document.querySelectorAll(".panel")];
      panels.forEach((panel) => panel.classList.remove("is-active"));
      document.querySelector(`#tab-${tab.dataset.tab}`)?.classList.add("is-active");
    });
  });
}

function bindWallet() {
  const connectBtn = document.querySelector("#wallet-connect");
  const switchNetworkBtn = document.querySelector("#wallet-switch-network");

  connectBtn.addEventListener("click", async () => {
    try {
      await connectWallet();
    } catch (error) {
      setWalletStatus(`Wallet error: ${errorMessage(error)}`);
    }
  });

  switchNetworkBtn.addEventListener("click", async () => {
    try {
      await switchToHoodi();
    } catch (error) {
      setWalletStatus(`Switch error: ${errorMessage(error)}`);
    }
  });

  if (!window.ethereum) {
    updateWalletUi();
    return;
  }

  window.ethereum
    .request({ method: "eth_accounts" })
    .then((accounts) => {
      if (accounts?.[0]) {
        state.wallet.account = normalizeAddress(accounts[0]);
        state.claim.account = state.wallet.account;
      }
      updateWalletUi();
      maybeEnableClaimButton();
      renderDepositGenerated();
    })
    .catch(() => {
      updateWalletUi();
    });

  window.ethereum
    .request({ method: "eth_chainId" })
    .then((chainIdHex) => {
      state.wallet.chainId = BigInt(chainIdHex);
      updateWalletUi();
      maybeEnableClaimButton();
      renderDepositGenerated();
    })
    .catch(() => {
      updateWalletUi();
    });

  window.ethereum.on?.("accountsChanged", (accounts) => {
    state.wallet.account = accounts?.[0] ? normalizeAddress(accounts[0]) : "";
    state.claim.account = state.wallet.account;
    updateWalletUi();
    maybeEnableClaimButton();
    renderDepositGenerated();
  });

  window.ethereum.on?.("chainChanged", (chainIdHex) => {
    state.wallet.chainId = BigInt(chainIdHex);
    updateWalletUi();
    maybeEnableClaimButton();
    renderDepositGenerated();
  });
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No injected wallet detected. Install MetaMask or another EIP-1193 wallet.");
  }

  const [accounts, chainIdHex] = await Promise.all([
    window.ethereum.request({ method: "eth_requestAccounts" }),
    window.ethereum.request({ method: "eth_chainId" })
  ]);

  const account = accounts?.[0];
  if (!account) {
    throw new Error("Wallet did not return an account.");
  }

  state.wallet.account = normalizeAddress(account);
  state.wallet.chainId = BigInt(chainIdHex);
  state.claim.account = state.wallet.account;
  updateWalletUi();
  maybeEnableClaimButton();
  renderDepositGenerated();
}

async function switchToHoodi() {
  if (!window.ethereum) {
    throw new Error("No injected wallet detected. Install MetaMask or another EIP-1193 wallet.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_CHAIN_HEX }]
    });
  } catch (error) {
    const code = Number(error?.code);
    if (code !== 4902) {
      throw error;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [HOODI_CHAIN_PARAMS]
    });
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_CHAIN_HEX }]
    });
  }

  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  state.wallet.chainId = BigInt(chainIdHex);
  updateWalletUi();
  maybeEnableClaimButton();
  renderDepositGenerated();
}

function updateWalletUi() {
  const connectBtn = document.querySelector("#wallet-connect");
  const switchNetworkBtn = document.querySelector("#wallet-switch-network");
  const status = document.querySelector("#wallet-status");

  if (!window.ethereum) {
    connectBtn.disabled = true;
    switchNetworkBtn.classList.add("hidden");
    setWalletStatus("Wallet: not detected (install MetaMask)");
    return;
  }

  connectBtn.disabled = false;
  const account = state.wallet.account;
  const chainId = state.wallet.chainId;

  if (!account) {
    connectBtn.textContent = "Connect Wallet";
    switchNetworkBtn.classList.add("hidden");
    setWalletStatus("Wallet: not connected");
    return;
  }

  const [first, last] = shortAddressParts(account);
  connectBtn.textContent = "Wallet Connected";

  if (chainId && chainId !== HOODI_CHAIN_ID) switchNetworkBtn.classList.remove("hidden");
  else switchNetworkBtn.classList.add("hidden");

  const chainText = chainId ? chainId.toString() : "unknown";
  status.textContent = `Wallet: 0x${first}...${last}  |  Chain: ${chainText}`;
}

function setWalletStatus(text) {
  const status = document.querySelector("#wallet-status");
  status.textContent = text;
}

function bindDeposit() {
  const generateBtn = document.querySelector("#deposit-download");
  const addNoteBtn = document.querySelector("#deposit-add-note");
  const saveBtn = document.querySelector("#deposit-save");
  const sendEtherBtn = document.querySelector("#deposit-send-ether");
  const startOverBtn = document.querySelector("#deposit-start-over");

  addNoteBtn.addEventListener("click", () => {
    if (state.deposit.isGenerating || state.deposit.generated) return;
    if (state.deposit.notes.length >= MAX_NOTES) {
      setDepositOutput(`Maximum ${MAX_NOTES} notes allowed.`);
      return;
    }
    state.deposit.notes.push(newNote(state.deposit.nextNoteId));
    state.deposit.nextNoteId += 1;
    saveDepositToStorage();
    renderDepositNotes();
  });

  saveBtn.addEventListener("click", async () => {
    try {
      const generated = state.deposit.generated;
      if (!generated?.depositJson) {
        throw new Error("Generate deposit file first.");
      }
      const savedPath = await saveDepositFileAs(generated);
      if (savedPath) {
        state.deposit.fileSaved = true;
        state.deposit.savedFilePath = savedPath;
        state.deposit.generated.filePath = savedPath;
        // Cache in localStorage for future reference (up to 5 recent files)
        try {
          const recentDeposits = JSON.parse(localStorage.getItem("shadow.recentDeposits") || "[]");
          // Remove if already exists (to move to front)
          const filtered = recentDeposits.filter((d) => d.path !== savedPath);
          // Add to front
          filtered.unshift({
            path: savedPath,
            json: generated.depositJson,
            savedAt: Date.now()
          });
          // Keep only 5 most recent
          const trimmed = filtered.slice(0, 5);
          localStorage.setItem("shadow.recentDeposits", JSON.stringify(trimmed));
          // Update prove tab with new file list
          checkRecentDeposit();
        } catch (e) {
          // Ignore localStorage errors
        }
        renderDepositGenerated();
        clearDepositOutput();
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        clearDepositOutput();
        return;
      }
      setDepositOutput(errorMessage(error));
    }
  });

  sendEtherBtn.addEventListener("click", async () => {
    try {
      if (!state.deposit.generated) {
        throw new Error("Generate deposit first.");
      }
      if (!state.deposit.fileSaved) {
        throw new Error("Save deposit file first.");
      }
      if (!state.wallet.account) {
        throw new Error("Connect wallet first.");
      }
      if (state.wallet.chainId !== HOODI_CHAIN_ID) {
        throw new Error(`Switch wallet to Hoodi (${HOODI_CHAIN_ID.toString()}) first.`);
      }
      if (!window.ethereum) {
        throw new Error("No injected wallet detected.");
      }

      sendEtherBtn.disabled = true;
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: state.wallet.account,
            to: state.deposit.generated.targetAddress,
            value: toQuantityHex(state.deposit.generated.totalWei)
          }
        ]
      });

      state.deposit.tx = {
        hash: txHash,
        chainId: state.wallet.chainId,
        status: "pending"
      };
      renderDepositGenerated();
      clearDepositOutput();
      trackDepositTransaction(txHash);
    } catch (error) {
      setDepositOutput(errorMessage(error));
      renderDepositGenerated();
    }
  });

  startOverBtn.addEventListener("click", () => {
    // Abort any ongoing generation
    if (state.deposit.abortController) {
      state.deposit.abortController.abort();
      state.deposit.abortController = null;
    }
    state.deposit.generated = null;
    state.deposit.fileSaved = false;
    state.deposit.savedFilePath = "";
    state.deposit.tx = null;
    state.deposit.isGenerating = false;
    state.deposit.notes = [newNote(0)];
    state.deposit.nextNoteId = 1;
    saveDepositToStorage();
    renderDepositGenerated();
    renderDepositNotes();
    clearDepositOutput();
  });

  generateBtn.addEventListener("click", async () => {
    if (state.deposit.generated) return;
    generateBtn.disabled = true;
    addNoteBtn.disabled = true;
    state.deposit.isGenerating = true;
    state.deposit.abortController = new AbortController();
    renderDepositNotes();
    try {
      setDepositOutput("Generating PoW-valid secret and building deposit...");
      const built = await buildDepositPayload(state.deposit, {
        minePowSecret: true,
        signal: state.deposit.abortController.signal,
        onMiningProgress: (attempts) => {
          setDepositOutput(
            `Generating PoW-valid secret and building deposit... attempts: ${attempts.toLocaleString()}`
          );
        }
      });
      const stamp = timestampForFilename();
      const [first, last] = shortAddressParts(built.targetAddress);
      const fileName = `deposit-${first}-${last}-${stamp}.json`;

      state.deposit.generated = {
        fileName,
        filePath: "(not saved yet)",
        targetAddress: built.targetAddress,
        totalWei: built.totalWei,
        depositJson: built.depositJson
      };
      state.deposit.fileSaved = false;
      state.deposit.savedFilePath = "";
      state.deposit.tx = null;
      renderDepositGenerated();
      clearDepositOutput();
    } catch (error) {
      setDepositOutput(errorMessage(error));
    } finally {
      state.deposit.isGenerating = false;
      state.deposit.abortController = null;
      renderDepositNotes();
      addNoteBtn.disabled = Boolean(state.deposit.generated);
      generateBtn.disabled = false;
    }
  });
}

function renderDepositNotes() {
  const container = document.querySelector("#deposit-note-list");
  container.innerHTML = "";

  // Ensure at least one note exists
  if (state.deposit.notes.length === 0) {
    state.deposit.notes = [newNote(0)];
    state.deposit.nextNoteId = 1;
  }

  state.deposit.notes.forEach((note, index) => {
    const canRemove = state.deposit.notes.length > 1;
    const isLocked = state.deposit.isGenerating || Boolean(state.deposit.generated);
    const row = document.createElement("div");
    row.className = "note-row";
    row.innerHTML = `
      <input data-index="${index}" data-key="recipient" aria-label="Recipient" type="text" value="${escapeAttr(note.recipient)}" placeholder="0x..." ${isLocked ? "disabled" : ""} />
      <input data-index="${index}" data-key="amountEth" aria-label="Amount (ETH)" type="text" value="${escapeAttr(note.amountEth)}" placeholder="0.01" ${isLocked ? "disabled" : ""} />
      <input data-index="${index}" data-key="label" aria-label="Label" type="text" value="${escapeAttr(note.label)}" placeholder="team wallet" ${isLocked ? "disabled" : ""} />
      <button data-index="${index}" class="danger note-action" type="button" aria-label="Remove note" title="Remove note" ${canRemove && !isLocked ? "" : "disabled"}>-</button>
    `;

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", (event) => {
        const idx = Number(event.target.dataset.index);
        const key = event.target.dataset.key;
        state.deposit.notes[idx][key] = event.target.value.trim();
        saveDepositToStorage();
      });
    });

    row.querySelector("button").addEventListener("click", (event) => {
      if (!canRemove) return;
      const idx = Number(event.target.dataset.index);
      state.deposit.notes.splice(idx, 1);
      saveDepositToStorage();
      renderDepositNotes();
    });

    container.appendChild(row);
  });
}

function renderDepositGenerated() {
  const generatedWrap = document.querySelector("#deposit-generated");
  const actionsWrap = document.querySelector("#deposit-generated-actions");
  const generateBtn = document.querySelector("#deposit-download");
  const addNoteBtn = document.querySelector("#deposit-add-note");
  const saveBtn = document.querySelector("#deposit-save");
  const sendEtherBtn = document.querySelector("#deposit-send-ether");
  const generated = state.deposit.generated;
  const fileSaved = state.deposit.fileSaved;
  const txConfirmed = state.deposit.tx?.status === "confirmed";
  const txPending = state.deposit.tx?.status === "pending";

  addNoteBtn.disabled = state.deposit.isGenerating || Boolean(generated);

  if (!generated) {
    generatedWrap.classList.add("hidden");
    actionsWrap.classList.add("hidden");
    generateBtn.classList.remove("hidden");
    document.querySelector("#deposit-generated-target").textContent = "";
    document.querySelector("#deposit-generated-total").textContent = "";
    document.querySelector("#deposit-generated-path").textContent = "";
    updateDepositTxUi();
    return;
  }

  generatedWrap.classList.remove("hidden");
  actionsWrap.classList.remove("hidden");
  generateBtn.classList.add("hidden");
  document.querySelector("#deposit-generated-target").textContent = generated.targetAddress;
  document.querySelector("#deposit-generated-total").textContent =
    `${generated.totalWei.toString()} wei (${formatEther(generated.totalWei)} ETH)`;
  document.querySelector("#deposit-generated-path").textContent = generated.filePath;

  // Button visibility logic:
  // 1. Not saved yet: show Save button only
  // 2. Saved but no tx: show Deposit Ether button
  // 3. Tx pending: show disabled Deposit Ether button
  // 4. Tx confirmed: hide Save and Deposit Ether

  if (txConfirmed) {
    saveBtn.classList.add("hidden");
    sendEtherBtn.classList.add("hidden");
  } else if (fileSaved) {
    saveBtn.classList.add("hidden");
    sendEtherBtn.classList.remove("hidden");
    sendEtherBtn.disabled = txPending;
  } else {
    saveBtn.classList.remove("hidden");
    saveBtn.disabled = false;
    sendEtherBtn.classList.add("hidden");
  }

  updateDepositTxUi();
}

function updateDepositTxUi() {
  const tx = state.deposit.tx;
  const link = document.querySelector("#deposit-tx-link");
  const status = document.querySelector("#deposit-tx-status");

  if (!tx?.hash) {
    link.classList.add("hidden");
    link.href = "#";
    status.textContent = "";
    return;
  }

  link.classList.remove("hidden");
  link.href = `https://hoodi.taikoscan.io/tx/${tx.hash}`;
  link.textContent = "View transaction";

  const [hashFirst, hashLast] = shortAddressParts(tx.hash);
  const hashSuffix = ` (0x${hashFirst}...${hashLast})`;

  if (tx.status === "confirmed") {
    status.textContent = `Confirmed${hashSuffix}`;
  } else if (tx.status === "failed") {
    status.textContent = `Failed${hashSuffix}`;
  } else {
    status.textContent = `Confirming...${hashSuffix}`;
  }
}

async function trackDepositTransaction(txHash) {
  if (!window.ethereum) return;

  while (state.deposit.tx?.hash === txHash && state.deposit.tx?.status === "pending") {
    try {
      const receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [txHash]
      });

      if (receipt) {
        state.deposit.tx.status = receipt.status === "0x1" ? "confirmed" : "failed";
        renderDepositGenerated();
        return;
      }
    } catch (error) {
      setDepositOutput(`Receipt check failed: ${errorMessage(error)}`);
      return;
    }

    await sleep(3000);
  }
}

function bindProve() {
  const copyBtn = document.querySelector("#prove-command-copy");
  const noteSelectWrap = document.querySelector("#prove-note-select-wrap");

  bindRecentDeposit();

  const validateLoadedDeposit = async (options = {}) => {
    if (!state.prove.depositJson) {
      throw new Error("Load a DEPOSIT file first.");
    }

    setOutput("prove-output", "Validating deposit...");
    document.querySelector("#prove-check-again-wrap").classList.add("hidden");
    state.prove.selectedNoteIndex = null;
    state.prove.noteStatuses = [];
    state.prove.sufficientBalance = false;
    state.prove.commandText = "";
    state.prove.validationStamp = "";
    renderProveCommand();
    noteSelectWrap.classList.add("hidden");

    const rpcUrl = state.settings.rpcUrl;
    if (!rpcUrl) throw new Error("RPC URL is required. Configure it in Settings.");

    const rpcChainId = await fetchChainId(rpcUrl);
    let resolvedChainId = rpcChainId;

    if (state.prove.depositJson.chainId) {
      resolvedChainId = BigInt(state.prove.depositJson.chainId);
      if (resolvedChainId !== rpcChainId) {
        throw new Error(
          `chainId mismatch: deposit=${resolvedChainId.toString()} rpc=${rpcChainId.toString()}`
        );
      }
    }
    if (resolvedChainId !== HOODI_CHAIN_ID) {
      throw new Error(`Only Taiko Hoodi (167013) is supported. Resolved chainId=${resolvedChainId.toString()}`);
    }

    const usePrecomputed =
      options.precomputedDerived && options.precomputedChainId === resolvedChainId;
    const derived = usePrecomputed
      ? options.precomputedDerived
      : await deriveFromDeposit(state.prove.depositJson, resolvedChainId);
    if (state.prove.depositJson.targetAddress) {
      const expected = normalizeAddress(state.prove.depositJson.targetAddress);
      if (expected !== derived.targetAddress) {
        throw new Error(`targetAddress mismatch: deposit=${expected} derived=${derived.targetAddress}`);
      }
    }
    const targetBalance = await fetchBalanceWei(rpcUrl, derived.targetAddress);
    const sufficientBalance = targetBalance >= derived.totalAmount;

    state.prove.targetAddress = derived.targetAddress;
    state.prove.totalAmount = derived.totalAmount;
    state.prove.resolvedChainId = resolvedChainId;
    state.prove.sufficientBalance = sufficientBalance;

    if (!sufficientBalance) {
      setOutput(
        "prove-output",
        [
          `Target address: ${derived.targetAddress}`,
          `Chain ID: ${resolvedChainId.toString()}`,
          `Target balance: ${targetBalance.toString()} wei (${formatEther(targetBalance)} ETH)`,
          `Required: ${derived.totalAmount.toString()} wei (${formatEther(derived.totalAmount)} ETH)`,
          "Balance sufficient: no"
        ].join("\n")
      );
      document.querySelector("#prove-check-again-wrap").classList.remove("hidden");
      return;
    }

    const shadowAddress = DEFAULT_SHADOW_ADDRESS ? normalizeAddress(DEFAULT_SHADOW_ADDRESS) : "";

    const noteStatuses = await Promise.all(
      derived.notes.map(async (note) => {
        if (!shadowAddress) {
          return {
            ...note,
            claimed: false,
            claimedSource: "assumed"
          };
        }

        const claimed = await checkConsumed(rpcUrl, shadowAddress, note.nullifier);
        return {
          ...note,
          claimed,
          claimedSource: "onchain"
        };
      })
    );

    state.prove.noteStatuses = noteStatuses;
    const firstUnclaimed = noteStatuses.find((note) => !note.claimed);
    state.prove.selectedNoteIndex = firstUnclaimed ? firstUnclaimed.index : null;
    state.prove.validationStamp = timestampForFilename();
    renderProveNotes();

    const unclaimedCount = noteStatuses.filter((note) => !note.claimed).length;
    const lines = [
      `Target address: ${derived.targetAddress}`,
      `Chain ID: ${resolvedChainId.toString()}`,
      `Target balance: ${targetBalance.toString()} wei (${formatEther(targetBalance)} ETH)`,
      `Required: ${derived.totalAmount.toString()} wei (${formatEther(derived.totalAmount)} ETH)`,
      `Balance sufficient: ${sufficientBalance ? "yes" : "no"}`,
      shadowAddress
        ? `Unclaimed notes: ${unclaimedCount}/${noteStatuses.length} (on-chain checked)`
        : `Unclaimed notes: ${unclaimedCount}/${noteStatuses.length} (assumed, no Shadow contract provided)`
    ];

    setOutput("prove-output", lines.join("\n"));
    if (sufficientBalance && unclaimedCount > 0) {
      state.prove.commandText = buildProveCommand();
    } else {
      state.prove.commandText = "";
    }
    renderProveCommand();
  };

  copyBtn.addEventListener("click", async () => {
    try {
      if (!state.prove.commandText) return;
      await navigator.clipboard.writeText(state.prove.commandText);
      setOutput("prove-output", "Proof command copied.");
    } catch (error) {
      setOutput("prove-output", `Copy failed: ${errorMessage(error)}`);
    }
  });

  document.querySelector("#prove-platform-emulation").addEventListener("change", (e) => {
    state.prove.platformEmulation = e.target.checked;
    if (state.prove.sufficientBalance) {
      state.prove.commandText = buildProveCommand();
      renderProveCommand();
    }
  });

  document.querySelector("#prove-verbose-output").addEventListener("change", (e) => {
    state.prove.verboseOutput = e.target.checked;
    if (state.prove.sufficientBalance) {
      state.prove.commandText = buildProveCommand();
      renderProveCommand();
    }
  });

  document.querySelector("#prove-check-again").addEventListener("click", async () => {
    try {
      await validateLoadedDeposit();
    } catch (error) {
      setOutput("prove-output", errorMessage(error));
    }
  });

  wireDropZone({
    zone: document.querySelector("#prove-drop-zone"),
    fileInput: document.querySelector("#prove-file-input"),
    onFile: async (file) => {
      try {
        const parsed = await readJsonFile(file);
        const normalized = normalizeDeposit(parsed);
        const chainId = BigInt(normalized.chainId);
        const derived = await deriveFromDeposit(normalized, chainId);
        if (normalized.targetAddress) {
          const expected = normalizeAddress(normalized.targetAddress);
          if (expected !== derived.targetAddress) {
            throw new Error(`targetAddress mismatch: deposit=${expected} derived=${derived.targetAddress}`);
          }
        }
        state.prove.depositFileName = file.name;
        state.prove.depositFilePath = resolveLocalFilePath(file);
        state.prove.depositJson = normalized;
        state.prove.loadedSummary = {
          targetAddress: derived.targetAddress,
          totalWei: derived.totalAmount,
          filePath: state.prove.depositFilePath || file.name
        };
        state.prove.commandText = "";
        state.prove.validationStamp = "";
        state.prove.targetAddress = derived.targetAddress;
        state.prove.totalAmount = derived.totalAmount;
        state.prove.resolvedChainId = chainId;
        state.prove.selectedNoteIndex = null;
        state.prove.noteStatuses = [];
        state.prove.sufficientBalance = false;
        renderProveLoadedSummary();
        renderProveCommand();

        try {
          await validateLoadedDeposit({
            precomputedDerived: derived,
            precomputedChainId: chainId
          });
        } catch (error) {
          state.prove.noteStatuses = [];
          state.prove.selectedNoteIndex = null;
          state.prove.sufficientBalance = false;
          state.prove.commandText = "";
          state.prove.validationStamp = "";
          noteSelectWrap.classList.add("hidden");
          renderProveCommand();
          setOutput("prove-output", errorMessage(error));
        }
      } catch (error) {
        state.prove.depositFileName = "";
        state.prove.depositFilePath = "";
        state.prove.depositJson = null;
        state.prove.loadedSummary = null;
        state.prove.selectedNoteIndex = null;
        state.prove.noteStatuses = [];
        state.prove.sufficientBalance = false;
        state.prove.commandText = "";
        state.prove.validationStamp = "";
        state.prove.targetAddress = "";
        state.prove.totalAmount = 0n;
        state.prove.resolvedChainId = null;
        renderProveLoadedSummary();
        renderProveCommand();
        noteSelectWrap.classList.add("hidden");
        setOutput("prove-output", errorMessage(error));
      }
    }
  });

  // Handle recent deposit selection
  document.addEventListener("deposit-loaded", async () => {
    try {
      const normalized = normalizeDeposit(state.prove.depositJson);
      const chainId = BigInt(normalized.chainId);
      const derived = await deriveFromDeposit(normalized, chainId);

      state.prove.loadedSummary = {
        targetAddress: derived.targetAddress,
        totalWei: derived.totalAmount,
        filePath: state.prove.depositFilePath || state.prove.depositFileName
      };
      state.prove.targetAddress = derived.targetAddress;
      state.prove.totalAmount = derived.totalAmount;
      state.prove.resolvedChainId = chainId;
      renderProveLoadedSummary();

      await validateLoadedDeposit({
        precomputedDerived: derived,
        precomputedChainId: chainId
      });
    } catch (error) {
      setOutput("prove-output", errorMessage(error));
    }
  });
}

function renderProveLoadedSummary() {
  const wrap = document.querySelector("#prove-loaded-summary");
  const summary = state.prove.loadedSummary;
  if (!summary) {
    wrap.classList.add("hidden");
    document.querySelector("#prove-summary-target").textContent = "";
    document.querySelector("#prove-summary-total").textContent = "";
    document.querySelector("#prove-summary-path").textContent = "";
    return;
  }

  wrap.classList.remove("hidden");
  document.querySelector("#prove-summary-target").textContent = summary.targetAddress;
  document.querySelector("#prove-summary-total").textContent =
    `${summary.totalWei.toString()} wei (${formatEther(summary.totalWei)} ETH)`;
  document.querySelector("#prove-summary-path").textContent = summary.filePath;
}

function renderProveCommand() {
  const wrap = document.querySelector("#prove-command-wrap");
  const text = state.prove.commandText;

  if (!text) {
    wrap.classList.add("hidden");
    document.querySelector("#prove-command").textContent = "";
    return;
  }

  wrap.classList.remove("hidden");
  document.querySelector("#prove-command").textContent = text;
}

function buildProveCommand() {
  const depositFileName = state.prove.depositFileName || "deposit.json";
  const baseName = depositFileName.replace(/\.json$/i, "");
  const succinctFileName = `${baseName}-succinct.json`;
  const proofFileName = `${baseName}-proofs.json`;
  const depositJson = JSON.stringify(state.prove.depositJson);
  const platformFlag = state.prove.platformEmulation ? "--platform linux/amd64 " : "";
  const verboseFlag = state.prove.verboseOutput ? "-e VERBOSE=true " : "";
  const dockerImage = "ghcr.io/taikoxyz/taiko-shadow:dev";

  // Phase 1: Generate succinct STARK proofs (no Docker socket needed)
  const phase1 = `docker run --rm ${platformFlag}${verboseFlag}-v "$(pwd)":/data ${dockerImage} prove /data/${depositFileName}`;
  // Phase 2: Compress to Groth16 (requires Docker socket AND RISC0_WORK_DIR for Docker-in-Docker path translation)
  const phase2 = `docker run --rm ${platformFlag}${verboseFlag}-e RISC0_WORK_DIR="$(pwd)" -v "$(pwd)":"$(pwd)" -v /var/run/docker.sock:/var/run/docker.sock ${dockerImage} compress "$(pwd)"/${succinctFileName}`;

  // Generate single-line executable command using echo instead of heredoc
  return [
    `rm -f ./${depositFileName} ./${succinctFileName} ./${proofFileName}`,
    `echo '${depositJson.replace(/'/g, "'\\''")}' > ./${depositFileName}`,
    phase1,
    phase2,
    `rm -f ./${succinctFileName} && echo "Done! Proof file: ./${proofFileName}"`
  ].join(" && \\\n");
}

function resolveLocalFilePath(file) {
  const rawPath = file && typeof file.path === "string" ? file.path.trim() : "";
  if (rawPath) return rawPath;
  const relative = file && typeof file.webkitRelativePath === "string" ? file.webkitRelativePath.trim() : "";
  if (relative) return relative;
  return file?.name || "";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function renderProveNotes() {
  const wrap = document.querySelector("#prove-note-select-wrap");
  const list = document.querySelector("#prove-note-list");
  list.innerHTML = "";

  const unclaimed = state.prove.noteStatuses.filter((note) => !note.claimed);
  if (unclaimed.length === 0) {
    state.prove.selectedNoteIndex = null;
    wrap.classList.remove("hidden");
    list.innerHTML = `<p class="sub">No unclaimed notes available.</p>`;
    return;
  }

  wrap.classList.remove("hidden");
  unclaimed.forEach((note) => {
    const item = document.createElement("div");
    item.className = "note-info";
    item.innerHTML = `
      <span class="note-info-content">
        #${note.index} • ${formatEther(note.amountWei)} ETH
        <small>Recipient: ${note.recipient}</small>
      </span>
    `;
    list.appendChild(item);
  });
}

function bindClaim() {
  const processProofFile = (parsed, fileName) => {
    // Handle multi-proof files (from Docker output)
    if (Array.isArray(parsed.proofs) && parsed.proofs.length > 0) {
      state.claim.multiProofFile = parsed;
      state.claim.proofFileName = fileName;

      const lines = [
        `Loaded multi-proof file: ${fileName}`,
        `Version: ${parsed.version || "unknown"}`,
        `Phase: ${parsed.phase || "unknown"}`,
        `Chain ID: ${parsed.chainId}`,
        `Notes: ${parsed.proofs.length}`,
        "",
        "Available proofs:"
      ];

      parsed.proofs.forEach((p, idx) => {
        const amount = p.journal?.amount ?? "unknown";
        const recipient = p.journal?.recipient
          ? bytesToHex(new Uint8Array(p.journal.recipient))
          : "unknown";
        lines.push(`  [${idx}] Note ${p.noteIndex}: ${amount} wei to ${recipient}`);
      });

      lines.push("");
      lines.push("Select a proof index below to claim:");

      setOutput("claim-output", lines.join("\n"));
      showProofSelector(parsed.proofs);
      return;
    }

    // Single proof file
    const prepared = prepareClaimPayload(parsed);
    const grossWei = prepared.claimInput.amount;
    const feeWei = grossWei / 1000n;
    const netWei = grossWei - feeWei;
    const proofBytes = hexDataByteLength(prepared.proof);
    state.claim.proofJson = parsed;
    state.claim.proofPayload = prepared;
    state.claim.proofFileName = fileName;
    state.claim.multiProofFile = null;
    maybeEnableClaimButton();
    hideProofSelector();
    setOutput(
      "claim-output",
      [
        `Loaded proof file: ${fileName}`,
        `Proof version: ${String(parsed.version || "unknown")}`,
        `Chain ID: ${prepared.chainId.toString()}`,
        `Checkpoint block: ${prepared.claimInput.blockNumber.toString()}`,
        `Recipient: ${prepared.claimInput.recipient}`,
        `Nullifier: ${prepared.claimInput.nullifier}`,
        prepared.blockHash ? `Checkpoint blockHash: ${prepared.blockHash}` : null,
        `Gross amount: ${grossWei.toString()} wei (${formatEther(grossWei)} ETH)`,
        `Fee (0.1%): ${feeWei.toString()} wei (${formatEther(feeWei)} ETH)`,
        `Net to recipient: ${netWei.toString()} wei (${formatEther(netWei)} ETH)`,
        `Proof bytes: ${proofBytes.toLocaleString()}`,
        proofBytes > HOODI_MAX_TX_SIZE_BYTES
          ? `Tx-size warning: proof bytes exceed Hoodi limit (${HOODI_MAX_TX_SIZE_BYTES}).`
          : "Tx-size check: within Hoodi limit."
      ].filter(Boolean).join("\n")
    );
  };

  wireDropZone({
    zone: document.querySelector("#claim-drop-zone"),
    fileInput: document.querySelector("#claim-file-input"),
    onFile: async (file) => {
      try {
        const parsed = await readJsonFile(file);
        processProofFile(parsed, file.name);
      } catch (error) {
        setOutput("claim-output", errorMessage(error));
      }
    }
  });

  document.querySelector("#claim-connect").addEventListener("click", async () => {
    try {
      await connectWallet();
      setOutput("claim-output", `Connected wallet: ${state.claim.account}`);
    } catch (error) {
      setOutput("claim-output", errorMessage(error));
    }
  });

  document.querySelector("#claim-submit").addEventListener("click", async () => {
    try {
      if (!window.ethereum) throw new Error("Injected wallet is required.");
      if (!state.claim.account) throw new Error("Connect wallet first.");
      if (!state.claim.proofPayload) throw new Error("Load proof file first.");

      if (!DEFAULT_SHADOW_ADDRESS) {
        throw new Error("Shadow contract not deployed.");
      }
      const shadowAddress = normalizeAddress(DEFAULT_SHADOW_ADDRESS);

      const walletChainId = BigInt(await window.ethereum.request({ method: "eth_chainId" }));
      const proofChainId = state.claim.proofPayload.chainId;
      if (walletChainId !== HOODI_CHAIN_ID) {
        throw new Error(`Only Taiko Hoodi (167013) is supported. Wallet chainId is ${walletChainId.toString()}.`);
      }
      if (proofChainId !== HOODI_CHAIN_ID) {
        throw new Error(`Only Taiko Hoodi (167013) proofs are supported. Proof chainId is ${proofChainId.toString()}.`);
      }
      if (walletChainId !== proofChainId) {
        throw new Error(
          `wallet chainId (${walletChainId.toString()}) does not match proof chainId (${proofChainId.toString()})`
        );
      }

      const data = encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "claim",
            stateMutability: "nonpayable",
            inputs: [
              { name: "_proof", type: "bytes" },
              {
                name: "_input",
                type: "tuple",
                components: [
                  { name: "blockNumber", type: "uint64" },
                  { name: "chainId", type: "uint256" },
                  { name: "amount", type: "uint256" },
                  { name: "recipient", type: "address" },
                  { name: "nullifier", type: "bytes32" }
                ]
              }
            ],
            outputs: []
          }
        ],
        functionName: "claim",
        args: [state.claim.proofPayload.proof, state.claim.proofPayload.claimInput]
      });
      const txSizeBytes = hexDataByteLength(data);
      if (txSizeBytes > HOODI_MAX_TX_SIZE_BYTES) {
        throw new Error(
          `proof tx is too large (${txSizeBytes} bytes > ${HOODI_MAX_TX_SIZE_BYTES}). ` +
            "Regenerate proof using --receipt-kind groth16."
        );
      }

      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: state.claim.account,
            to: shadowAddress,
            data
          }
        ]
      });

      setOutput(
        "claim-output",
        [
          `Submitted claim tx: ${txHash}`,
          `Proof file: ${state.claim.proofFileName}`,
          `Contract: ${shadowAddress}`
        ].join("\n")
      );
    } catch (error) {
      setOutput("claim-output", errorMessage(error));
    }
  });

  document.querySelector("#claim-parse-paste").addEventListener("click", () => {
    try {
      const pasteInput = document.querySelector("#claim-paste-input");
      const text = pasteInput.value.trim();
      if (!text) {
        setOutput("claim-output", "Paste proof JSON into the textarea first.");
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON. Check syntax and try again.");
      }

      // Use the same processing logic as file drop
      processProofFile(parsed, "(pasted)");
    } catch (error) {
      setOutput("claim-output", errorMessage(error));
    }
  });

}

function maybeEnableClaimButton() {
  const hasContract = Boolean(DEFAULT_SHADOW_ADDRESS);
  const onSupportedChain = state.wallet.chainId === HOODI_CHAIN_ID;
  document.querySelector("#claim-submit").disabled = !(
    hasContract &&
    state.claim.proofPayload &&
    state.claim.account &&
    onSupportedChain
  );
}

async function showProofSelector(proofs) {
  const selector = document.querySelector("#claim-proof-selector");
  const list = document.querySelector("#claim-proof-list");
  list.innerHTML = "";

  // Check which nullifiers are already consumed
  const consumedStatus = await Promise.all(
    proofs.map(async (proof) => {
      if (!DEFAULT_SHADOW_ADDRESS || !window.ethereum) return false;
      const nullifier = Array.isArray(proof.journal?.nullifier)
        ? bytesToHex(new Uint8Array(proof.journal.nullifier))
        : null;
      if (!nullifier) return false;
      try {
        const data = encodeFunctionData({
          abi: [{ type: "function", name: "isConsumed", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] }],
          functionName: "isConsumed",
          args: [nullifier]
        });
        const result = await window.ethereum.request({
          method: "eth_call",
          params: [{ to: DEFAULT_SHADOW_ADDRESS, data }, "latest"]
        });
        return result !== "0x0000000000000000000000000000000000000000000000000000000000000000";
      } catch {
        return false;
      }
    })
  );

  proofs.forEach((proof, idx) => {
    const journal = proof.journal || {};
    const amount = journal.amount ?? "unknown";
    const amountEth = typeof amount === "number" ? formatEther(BigInt(amount)) : "?";
    const recipient = Array.isArray(journal.recipient)
      ? normalizeAddress(bytesToHex(new Uint8Array(journal.recipient)))
      : "unknown";
    const [first, last] = shortAddressParts(recipient);
    const isClaimed = consumedStatus[idx];

    const item = document.createElement("button");
    item.type = "button";
    item.className = isClaimed ? "proof-item proof-item-claimed" : "proof-item";
    item.dataset.index = idx;
    item.disabled = isClaimed;
    item.innerHTML = `
      <span class="proof-item-index">#${proof.noteIndex}</span>
      <span class="proof-item-amount">${amountEth} ETH</span>
      <span class="proof-item-recipient">to 0x${first}...${last}</span>
      ${isClaimed ? '<span class="proof-item-status">Claimed</span>' : ""}
    `;
    if (!isClaimed) {
      item.addEventListener("click", () => selectProofFromMulti(idx));
    }
    list.appendChild(item);
  });

  selector.classList.remove("hidden");
}

function hideProofSelector() {
  document.querySelector("#claim-proof-selector").classList.add("hidden");
  document.querySelector("#claim-proof-list").innerHTML = "";
}

function selectProofFromMulti(index) {
  const multiFile = state.claim.multiProofFile;
  if (!multiFile || !Array.isArray(multiFile.proofs)) {
    setOutput("claim-output", "No multi-proof file loaded.");
    return;
  }

  const proofEntry = multiFile.proofs[index];
  if (!proofEntry) {
    setOutput("claim-output", `Invalid proof index: ${index}`);
    return;
  }

  state.claim.selectedProofIndex = index;

  // Convert Docker proof format to claim-compatible format
  const converted = convertDockerProofToClaim(proofEntry, multiFile.chainId);

  try {
    const prepared = prepareClaimPayload(converted);
    const grossWei = prepared.claimInput.amount;
    const feeWei = grossWei / 1000n;
    const netWei = grossWei - feeWei;
    const proofBytes = hexDataByteLength(prepared.proof);

    state.claim.proofJson = converted;
    state.claim.proofPayload = prepared;
    maybeEnableClaimButton();
    hideProofSelector();

    setOutput(
      "claim-output",
      [
        `Selected proof #${proofEntry.noteIndex} from multi-proof file`,
        `Proof file: ${state.claim.proofFileName}`,
        `Chain ID: ${prepared.chainId.toString()}`,
        `Checkpoint block: ${prepared.claimInput.blockNumber.toString()}`,
        `Recipient: ${prepared.claimInput.recipient}`,
        `Nullifier: ${prepared.claimInput.nullifier}`,
        prepared.blockHash ? `Checkpoint blockHash: ${prepared.blockHash}` : null,
        `Gross amount: ${grossWei.toString()} wei (${formatEther(grossWei)} ETH)`,
        `Fee (0.1%): ${feeWei.toString()} wei (${formatEther(feeWei)} ETH)`,
        `Net to recipient: ${netWei.toString()} wei (${formatEther(netWei)} ETH)`,
        `Proof bytes: ${proofBytes.toLocaleString()}`,
        proofBytes > HOODI_MAX_TX_SIZE_BYTES
          ? `Tx-size warning: proof bytes exceed Hoodi limit (${HOODI_MAX_TX_SIZE_BYTES}).`
          : "Tx-size check: within Hoodi limit."
      ].filter(Boolean).join("\n")
    );
  } catch (error) {
    setOutput("claim-output", errorMessage(error));
  }
}

function convertDockerProofToClaim(proofEntry, chainId) {
  const journal = proofEntry.journal || {};

  // Convert byte arrays to hex strings
  const blockHash = Array.isArray(journal.block_hash)
    ? bytesToHex(new Uint8Array(journal.block_hash))
    : null;
  const recipient = Array.isArray(journal.recipient)
    ? bytesToHex(new Uint8Array(journal.recipient))
    : null;
  const nullifier = Array.isArray(journal.nullifier)
    ? bytesToHex(new Uint8Array(journal.nullifier))
    : null;

  // The circuit verifier expects the proof to be ABI-encoded as (bytes seal, bytes journal)
  // Docker outputs seal_hex and journal_hex separately, so we need to combine them
  const sealHex = proofEntry.seal_hex;
  const journalHex = proofEntry.journal_hex;

  if (!sealHex || !journalHex) {
    throw new Error("Docker proof missing seal_hex or journal_hex");
  }

  // ABI-encode (seal, journal) as the proof payload
  const encodedProof = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes" }],
    [sealHex, journalHex]
  );

  return {
    version: "1.0",
    proofHex: encodedProof,
    chainId: chainId || journal.chain_id?.toString(),
    blockNumber: journal.block_number,
    blockHash,
    amount: journal.amount?.toString(),
    recipient,
    nullifier
  };
}

function prepareClaimPayload(proof) {
  if (!proof || typeof proof !== "object") {
    throw new Error("Invalid proof file: expected JSON object");
  }

  const proofHex = resolveProofHex(proof);
  const publicInputs = resolvePublicInputs(proof);
  const fromPublicInputs = publicInputs ? deriveClaimFieldsFromPublicInputs(publicInputs) : null;

  const blockNumber = parseBigIntField(
    proof.blockNumber ?? fromPublicInputs?.blockNumber,
    "blockNumber"
  );
  const chainId = parseBigIntField(proof.chainId ?? fromPublicInputs?.chainId, "chainId");
  const amount = parseBigIntField(proof.amount ?? fromPublicInputs?.amount, "amount");
  const recipient = normalizeAddress(proof.recipient ?? fromPublicInputs?.recipient, "recipient");

  const nullifier = String(proof.nullifier ?? fromPublicInputs?.nullifier ?? "");
  let blockHash = proof.blockHash !== undefined ? String(proof.blockHash) : null;
  const derivedBlockHash = fromPublicInputs?.blockHash ?? null;

  assertHex(nullifier, 32, "nullifier");
  if (blockHash !== null) {
    assertHex(blockHash, 32, "blockHash");
  }

  if (blockNumber > (1n << 64n) - 1n) {
    throw new Error("blockNumber exceeds uint64 range");
  }
  if (amount <= 0n) {
    throw new Error("amount must be > 0");
  }

  if (fromPublicInputs) {
    assertDerivedFieldMatch("blockNumber", blockNumber, fromPublicInputs.blockNumber);
    assertDerivedFieldMatch("chainId", chainId, fromPublicInputs.chainId);
    assertDerivedFieldMatch("amount", amount, fromPublicInputs.amount);
    assertDerivedFieldMatch("recipient", recipient, fromPublicInputs.recipient);
    assertDerivedFieldMatch("nullifier", nullifier.toLowerCase(), fromPublicInputs.nullifier.toLowerCase());
    if (blockHash !== null) {
      assertDerivedFieldMatch("blockHash", blockHash.toLowerCase(), fromPublicInputs.blockHash.toLowerCase());
    }
  }

  if (derivedBlockHash) blockHash = derivedBlockHash;

  return {
    proof: proofHex,
    chainId,
    blockHash,
    claimInput: {
      blockNumber,
      chainId,
      amount,
      recipient,
      nullifier
    }
  };
}

function resolveProofHex(proof) {
  // Support multiple formats: risc0.proof, proofHex, seal_hex (from Docker output)
  const value = proof?.risc0?.proof ?? proof?.proofHex ?? proof?.risc0?.proofHex ?? proof?.seal_hex;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid proof file: missing valid proof bytes (risc0.proof, proofHex, or seal_hex)");
  }
  return value;
}

function resolvePublicInputs(proof) {
  if (Array.isArray(proof?.publicInputs)) return proof.publicInputs;
  if (Array.isArray(proof?.risc0?.publicInputs)) return proof.risc0.publicInputs;
  return null;
}

function deriveClaimFieldsFromPublicInputs(publicInputs) {
  if (!Array.isArray(publicInputs) || publicInputs.length !== PUBLIC_INPUTS_LEN) {
    throw new Error(`Invalid proof file: publicInputs must have length ${PUBLIC_INPUTS_LEN}`);
  }

  return {
    blockNumber: parseBigIntField(publicInputs[PUBLIC_INPUT_IDX.BLOCK_NUMBER], "publicInputs.blockNumber"),
    chainId: parseBigIntField(publicInputs[PUBLIC_INPUT_IDX.CHAIN_ID], "publicInputs.chainId"),
    amount: parseBigIntField(publicInputs[PUBLIC_INPUT_IDX.AMOUNT], "publicInputs.amount"),
    recipient: normalizeAddress(bytesToHex(readPublicInputBytes(publicInputs, PUBLIC_INPUT_IDX.RECIPIENT, 20))),
    nullifier: bytesToHex(readPublicInputBytes(publicInputs, PUBLIC_INPUT_IDX.NULLIFIER, 32)),
    blockHash: bytesToHex(readPublicInputBytes(publicInputs, PUBLIC_INPUT_IDX.BLOCK_HASH, 32))
  };
}

function readPublicInputBytes(publicInputs, offset, length) {
  if (publicInputs.length < offset + length) {
    throw new Error(`Invalid proof file: publicInputs out of range for offset ${offset} length ${length}`);
  }

  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const value = parseBigIntField(publicInputs[offset + i], `publicInputs[${offset + i}]`);
    if (value < 0n || value > 255n) {
      throw new Error(`Invalid proof file: publicInputs[${offset + i}] is not a byte`);
    }
    out[i] = Number(value);
  }
  return out;
}

function assertDerivedFieldMatch(fieldName, provided, derived) {
  if (provided !== derived) {
    throw new Error(`Invalid proof file: ${fieldName} does not match publicInputs`);
  }
}

function parseBigIntField(value, fieldName) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(value) || /^[0-9]+$/.test(value)) {
      return BigInt(value);
    }
  }
  throw new Error(`Invalid ${fieldName}: expected integer`);
}

function hexDataByteLength(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return 0;
  return (hex.length - 2) / 2;
}

function normalizeRpcUrl(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function wireDropZone({ zone, fileInput, onFile }) {
  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keypress", (event) => {
    if (event.key === "Enter" || event.key === " ") fileInput.click();
  });

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await onFile(file);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((name) => {
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add("is-over");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove("is-over");
    });
  });

  zone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) await onFile(file);
  });
}

async function readJsonFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON file: ${file.name}`);
  }
}

function normalizeDeposit(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid deposit JSON");
  if (raw.version !== "v2") throw new Error("deposit.version must be v2");

  assertHex(raw.secret, 32, "secret");
  if (typeof raw.chainId !== "string" || !/^[0-9]+$/.test(raw.chainId)) {
    throw new Error("deposit.chainId must be a decimal string");
  }
  if (BigInt(raw.chainId) !== HOODI_CHAIN_ID) {
    throw new Error(`deposit.chainId must be ${HOODI_CHAIN_ID.toString()} (Hoodi)`);
  }
  if (!Array.isArray(raw.notes) || raw.notes.length === 0 || raw.notes.length > MAX_NOTES) {
    throw new Error(`deposit.notes must contain 1..${MAX_NOTES} notes`);
  }

  const notes = raw.notes.map((note, idx) => {
    const recipient = normalizeAddress(note.recipient, `notes[${idx}].recipient`);
    if (typeof note.amount !== "string" || !/^[1-9][0-9]*$/.test(note.amount)) {
      throw new Error(`notes[${idx}].amount must be a non-zero wei integer string`);
    }

    const out = {
      recipient,
      amount: note.amount
    };

    if (note.label) out.label = String(note.label);
    return out;
  });

  const normalized = {
    version: "v2",
    chainId: raw.chainId,
    secret: raw.secret.toLowerCase(),
    notes
  };

  if (raw.targetAddress !== undefined) {
    normalized.targetAddress = normalizeAddress(raw.targetAddress, "targetAddress");
  }

  return normalized;
}

async function buildDepositPayload(input, options = {}) {
  if (input.chainId && BigInt(input.chainId) !== HOODI_CHAIN_ID) {
    throw new Error(`Only Hoodi (${HOODI_CHAIN_ID.toString()}) is supported.`);
  }
  const chainId = HOODI_CHAIN_ID;

  if (!Array.isArray(input.notes) || input.notes.length === 0) {
    throw new Error("Add at least one note.");
  }

  const notes = input.notes.map((note, idx) => {
    const recipient = normalizeAddress(note.recipient, `notes[${idx}].recipient`);
    let amountWei;

    try {
      amountWei = parseEther(note.amountEth || "0");
    } catch {
      throw new Error(`notes[${idx}].amount must be a valid ETH number`);
    }

    if (amountWei <= 0n) {
      throw new Error(`notes[${idx}].amount must be > 0 ETH`);
    }

    const out = {
      recipient,
      amount: amountWei.toString()
    };

    if (note.label) out.label = note.label;
    return out;
  });

  let secretHex = input.secret;
  let powAttempts = 0;
  if (options.minePowSecret) {
    const noteAmounts = notes.map((note) => BigInt(note.amount));
    const recipientHashes = await Promise.all(
      notes.map((note) => computeRecipientHash(hexToBytes(note.recipient)))
    );
    const notesHash = await computeNotesHash(noteAmounts, recipientHashes);

    const mined = await minePowValidSecret(notesHash, options.onMiningProgress, options.signal);
    secretHex = mined.secretHex;
    powAttempts = mined.attempts;
  }

  assertHex(secretHex, 32, "secret");

  const depositJson = {
    version: "v2",
    chainId: chainId.toString(),
    secret: secretHex.toLowerCase(),
    notes
  };

  const derived = await deriveFromDeposit(depositJson, chainId);
  if (!derived.powDigestValid) {
    throw new Error("secret does not satisfy PoW requirement for this note set (powDigest last 24 bits must be zero).");
  }
  depositJson.targetAddress = derived.targetAddress;

  return {
    depositJson,
    targetAddress: derived.targetAddress,
    totalWei: derived.totalAmount,
    powAttempts
  };
}

async function deriveFromDeposit(deposit, chainId) {
  const secretBytes = hexToBytes(deposit.secret);
  const noteAmounts = [];
  const recipientHashes = [];
  const notes = [];
  let totalAmount = 0n;

  for (let index = 0; index < deposit.notes.length; index += 1) {
    const note = deposit.notes[index];
    const amountWei = BigInt(note.amount);
    const recipient = normalizeAddress(note.recipient);
    const recipientBytes20 = hexToBytes(recipient);
    const recipientHash = await computeRecipientHash(recipientBytes20);
    const nullifier = bytesToHex(await deriveNullifier(secretBytes, chainId, index));

    noteAmounts.push(amountWei);
    recipientHashes.push(recipientHash);
    totalAmount += amountWei;

    notes.push({
      index,
      recipient,
      amountWei,
      nullifier
    });
  }

  if (totalAmount > MAX_TOTAL_WEI) {
    throw new Error(`total amount exceeds protocol max (${MAX_TOTAL_WEI.toString()} wei)`);
  }

  const notesHash = await computeNotesHash(noteAmounts, recipientHashes);
  const targetAddressBytes = await deriveTargetAddress(secretBytes, chainId, notesHash);
  const targetAddress = normalizeAddress(bytesToHex(targetAddressBytes));
  const powDigest = bytesToHex(await computePowDigest(notesHash, secretBytes));

  return {
    notes,
    targetAddress,
    totalAmount,
    powDigest,
    powDigestValid: powDigest.endsWith("000000")
  };
}

async function fetchChainId(rpcUrl) {
  const result = await rpcCall(rpcUrl, "eth_chainId", []);
  return BigInt(result);
}

async function fetchBalanceWei(rpcUrl, address) {
  const result = await rpcCall(rpcUrl, "eth_getBalance", [address, "latest"]);
  return BigInt(result);
}

async function checkConsumed(rpcUrl, shadowAddress, nullifier) {
  const data = `0x6346e832${nullifier.slice(2)}`;
  const result = await rpcCall(rpcUrl, "eth_call", [{ to: shadowAddress, data }, "latest"]);
  return BigInt(result) !== 0n;
}

async function rpcCall(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });

  if (!response.ok) {
    throw new Error(`RPC error ${response.status} on ${method}`);
  }

  const body = await response.json();
  if (body.error) {
    throw new Error(body.error.message || `RPC ${method} failed`);
  }

  return body.result;
}

async function computeRecipientHash(recipient20Bytes) {
  if (recipient20Bytes.length !== 20) throw new Error("recipient bytes must be 20 bytes");

  const magic = padMagicLabel(MAGIC.RECIPIENT);
  const paddedRecipient = new Uint8Array(32);
  paddedRecipient.set(recipient20Bytes, 12);

  return sha256Bytes(concatBytes(magic, paddedRecipient));
}

async function computeNotesHash(amounts, recipientHashes) {
  const buffer = new Uint8Array(MAX_NOTES * 64);

  for (let i = 0; i < amounts.length; i += 1) {
    buffer.set(bigintToBytes32(amounts[i]), i * 64);
    buffer.set(recipientHashes[i], i * 64 + 32);
  }

  return sha256Bytes(buffer);
}

async function deriveTargetAddress(secretBytes, chainId, notesHash) {
  const payload = concatBytes(
    padMagicLabel(MAGIC.ADDRESS),
    bigintToBytes32(chainId),
    secretBytes,
    notesHash
  );
  const digest = await sha256Bytes(payload);
  return digest.slice(12);
}

async function deriveNullifier(secretBytes, chainId, noteIndex) {
  const payload = concatBytes(
    padMagicLabel(MAGIC.NULLIFIER),
    bigintToBytes32(chainId),
    secretBytes,
    bigintToBytes32(BigInt(noteIndex))
  );
  return sha256Bytes(payload);
}

async function computePowDigest(notesHash, secretBytes) {
  const payload = concatBytes(notesHash, secretBytes);
  return sha256Bytes(payload);
}

function padMagicLabel(label) {
  const raw = encoder.encode(label);
  if (raw.length > 32) {
    throw new Error("magic label exceeds 32 bytes");
  }
  const out = new Uint8Array(32);
  out.set(raw);
  return out;
}

function bigintToBytes32(value) {
  if (value < 0n) throw new Error("cannot encode negative bigint");
  let hex = value.toString(16);
  if (hex.length > 64) throw new Error("bigint exceeds 32 bytes");
  hex = hex.padStart(64, "0");
  return hexToBytes(`0x${hex}`);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }

  return out;
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function hexToBytes(value) {
  return fromHex(value, "bytes");
}

function bytesToHex(bytes) {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function assertHex(value, byteLength, fieldName) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`${fieldName} must be 0x-prefixed hex`);
  }
  const hexLength = value.length - 2;
  if (hexLength !== byteLength * 2 || !/^[0-9a-fA-F]+$/.test(value.slice(2))) {
    throw new Error(`${fieldName} must be ${byteLength} bytes hex`);
  }
}

function normalizeAddress(value, fieldName = "address") {
  if (!isAddress(value)) {
    throw new Error(`${fieldName} is not a valid address`);
  }
  return getAddress(value);
}

async function minePowValidSecret(notesHash, onProgress, signal) {
  let attempts = 0;

  while (true) {
    if (signal?.aborted) {
      throw new Error("Generation aborted");
    }

    const secret = crypto.getRandomValues(new Uint8Array(32));
    const digest = sha256Sync(concatBytes(notesHash, secret));
    attempts += 1;

    if (powDigestIsValidBytes(digest)) {
      return {
        secretHex: bytesToHex(secret),
        attempts
      };
    }

    if (attempts % 20000 === 0) {
      onProgress?.(attempts);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

function powDigestIsValidBytes(digest) {
  return digest[29] === 0 && digest[30] === 0 && digest[31] === 0;
}

function newNote(index = 0) {
  return {
    recipient: "",
    amountEth: "",
    label: `note #${index}`
  };
}

function shortAddressParts(address) {
  const plain = address.toLowerCase().replace(/^0x/, "");
  return [plain.slice(0, 4), plain.slice(-4)];
}

function timestampForFilename() {
  const now = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

async function saveDepositFileAs(generated) {
  const jsonText = JSON.stringify(generated.depositJson, null, 2);

  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName: generated.fileName,
      types: [
        {
          description: "JSON file",
          accept: { "application/json": [".json"] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(jsonText);
    await writable.close();

    // Try to get full path (available in some environments like Electron)
    try {
      const file = await handle.getFile();
      if (file.path) {
        return file.path;
      }
    } catch (e) {
      // Ignore - fall back to name
    }

    return handle.name || generated.fileName;
  }

  downloadJson(generated.fileName, generated.depositJson);
  return generated.fileName;
}

function toQuantityHex(value) {
  return `0x${value.toString(16)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadJson(fileName, content) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

function setOutput(id, text) {
  document.querySelector(`#${id}`).textContent = text;
}

function setDepositOutput(text) {
  const node = document.querySelector("#deposit-output");
  if (!node) return;
  const message = String(text ?? "").trim();
  node.textContent = message;
  node.classList.toggle("hidden", message.length === 0);
}

function clearDepositOutput() {
  setDepositOutput("");
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function bindSettings() {
  const dialog = document.querySelector("#settings-dialog");
  const openBtn = document.querySelector("#footer-settings");
  const saveBtn = document.querySelector("#settings-save");
  const cancelBtn = document.querySelector("#settings-cancel");
  const rpcInput = document.querySelector("#settings-rpc");

  openBtn.addEventListener("click", () => {
    rpcInput.value = state.settings.rpcUrl.replace(/^https?:\/\//, "");
    dialog.showModal();
  });

  saveBtn.addEventListener("click", () => {
    const rpcRaw = rpcInput.value.trim();

    state.settings.rpcUrl = normalizeRpcUrl(rpcRaw);

    try {
      localStorage.setItem("shadow.rpcUrl", state.settings.rpcUrl);
    } catch (e) {
      // Ignore localStorage errors
    }

    updateFooterInfo();
    dialog.close();
  });

  cancelBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
}

function loadSettingsFromStorage() {
  try {
    const rpc = localStorage.getItem("shadow.rpcUrl");
    if (rpc) state.settings.rpcUrl = rpc;
  } catch (e) {
    // Ignore localStorage errors
  }
  updateFooterInfo();
  checkRecentDeposit();
}

function saveDepositToStorage() {
  try {
    const data = {
      notes: state.deposit.notes,
      nextNoteId: state.deposit.nextNoteId
    };
    localStorage.setItem("shadow.depositDraft", JSON.stringify(data));
  } catch (e) {
    // Ignore localStorage errors
  }
}

function loadDepositFromStorage() {
  try {
    const saved = localStorage.getItem("shadow.depositDraft");
    if (saved) {
      const data = JSON.parse(saved);
      if (Array.isArray(data.notes) && data.notes.length > 0) {
        state.deposit.notes = data.notes;
        state.deposit.nextNoteId = data.nextNoteId || data.notes.length;
      }
    }
  } catch (e) {
    // Ignore localStorage errors
  }
}

function updateFooterInfo() {
  const rpcDisplay = state.settings.rpcUrl.replace(/^https?:\/\//, "");
  document.querySelector("#footer-rpc").textContent = rpcDisplay;
  document.querySelector("#footer-shadow").textContent = DEFAULT_SHADOW_ADDRESS || "(not deployed)";
}

function checkRecentDeposit() {
  const recentWrap = document.querySelector("#prove-recent-deposit");
  const dropZone = document.querySelector("#prove-drop-zone");
  const recentList = document.querySelector("#prove-recent-list");

  try {
    const recentDeposits = JSON.parse(localStorage.getItem("shadow.recentDeposits") || "[]");

    if (recentDeposits.length > 0) {
      recentList.innerHTML = "";
      recentDeposits.forEach((deposit, index) => {
        const item = document.createElement("div");
        item.className = "recent-deposit-item";
        item.innerHTML = `
          <span class="recent-deposit-path">${escapeAttr(deposit.path)}</span>
          <div class="recent-deposit-actions">
            <button data-index="${index}" data-action="open" type="button" class="link-btn">Open</button>
            <button data-index="${index}" data-action="use" type="button" class="link-btn">Use</button>
            <button data-index="${index}" data-action="remove" type="button" class="link-btn danger-link">Remove</button>
          </div>
        `;
        item.querySelector('[data-action="use"]').addEventListener("click", () => {
          loadRecentDeposit(index);
        });
        item.querySelector('[data-action="open"]').addEventListener("click", () => {
          openRecentDeposit(index);
        });
        item.querySelector('[data-action="remove"]').addEventListener("click", () => {
          removeRecentDeposit(index);
        });
        recentList.appendChild(item);
      });
      recentWrap.classList.remove("hidden");
    } else {
      recentList.innerHTML = "";
      recentWrap.classList.add("hidden");
    }
    // Drop zone always visible
    dropZone.classList.remove("hidden");
  } catch (e) {
    // Ignore localStorage errors
  }
}

function loadRecentDeposit(index) {
  try {
    const recentDeposits = JSON.parse(localStorage.getItem("shadow.recentDeposits") || "[]");
    const deposit = recentDeposits[index];

    if (!deposit) {
      throw new Error("Deposit not found.");
    }

    state.prove.depositJson = deposit.json;
    state.prove.depositFileName = deposit.path.split("/").pop() || "deposit.json";
    state.prove.depositFilePath = deposit.path;

    document.querySelector("#prove-recent-deposit").classList.add("hidden");
    document.querySelector("#prove-drop-zone").classList.add("hidden");

    // Trigger validation
    const event = new CustomEvent("deposit-loaded");
    document.dispatchEvent(event);
  } catch (error) {
    setOutput("prove-output", errorMessage(error));
  }
}

function openRecentDeposit(index) {
  try {
    const recentDeposits = JSON.parse(localStorage.getItem("shadow.recentDeposits") || "[]");
    const deposit = recentDeposits[index];

    if (!deposit) {
      throw new Error("Deposit not found.");
    }

    const jsonText = JSON.stringify(deposit.json, null, 2);
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch (error) {
    setOutput("prove-output", errorMessage(error));
  }
}

function removeRecentDeposit(index) {
  try {
    const recentDeposits = JSON.parse(localStorage.getItem("shadow.recentDeposits") || "[]");
    recentDeposits.splice(index, 1);
    localStorage.setItem("shadow.recentDeposits", JSON.stringify(recentDeposits));
    checkRecentDeposit();
  } catch (error) {
    setOutput("prove-output", errorMessage(error));
  }
}

function bindRecentDeposit() {
  // Recent deposits and drop zone are now both visible
}
