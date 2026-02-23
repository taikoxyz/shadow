import {
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
// Intentionally empty: the correct address depends on the current deployment (image ID).
const DEFAULT_SHADOW_ADDRESS = "";
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
const HOODI_L1_CHAIN_ID = 560048n;
const HOODI_L1_CHAIN_HEX = "0x88bb0";
const HOODI_L1_RPC_HOST = "ethereum-hoodi-rpc.publicnode.com";
const HOODI_L1_RPC_URL = `https://${HOODI_L1_RPC_HOST}`;
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

const HOODI_L1_CHAIN_PARAMS = {
  chainId: HOODI_L1_CHAIN_HEX,
  chainName: "Taiko Hoodi L1",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: [HOODI_L1_RPC_URL]
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
        <button id="wallet-switch-l2" class="hidden" type="button">Switch to Hoodi L2 (167013)</button>
        <button id="wallet-switch-l1" class="hidden" type="button">Switch to Hoodi L1 (560048)</button>
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
      </div>

      <section id="deposit-generated" class="generated hidden">
        <h2>Summary</h2>
        <div class="generated-grid">
          <p><strong>Target</strong><span id="deposit-generated-target"></span></p>
          <p><strong>Total</strong><span id="deposit-generated-total"></span></p>
          <p>
            <strong>File path</strong>
            <span class="path-row">
              <span id="deposit-generated-path"></span>
              <button id="deposit-save-as" class="link-btn" type="button">Save As</button>
            </span>
          </p>
        </div>
      </section>
      <div id="deposit-generated-actions" class="generated-actions hidden">
        <div class="cta-row">
          <button id="deposit-send-ether" type="button" disabled>Deposit Ether (L1)</button>
          <button id="deposit-reset" type="button">Reset</button>
        </div>
        <div class="tx-row">
          <a id="deposit-tx-link" class="tx-link hidden" href="#" target="_blank" rel="noopener noreferrer">View transaction</a>
          <span id="deposit-tx-status" class="tx-status"></span>
        </div>
      </div>

      <pre id="deposit-output" class="output hidden"></pre>
    </section>

    <section class="panel" id="tab-prove">
      <div class="grid two">
        <label>
          L2 RPC URL (Hoodi)
          <input id="prove-rpc" type="text" value="${HOODI_RPC_HOST}" placeholder="${HOODI_RPC_HOST}" />
        </label>
        <label>
          L1 RPC URL (Hoodi L1)
          <input id="prove-l1-rpc" type="text" value="${HOODI_L1_RPC_HOST}" placeholder="${HOODI_L1_RPC_HOST}" />
        </label>
      </div>
      <label>
        Shadow contract (optional, for unclaimed check)
        <input id="prove-shadow-address" type="text" value="${DEFAULT_SHADOW_ADDRESS}" placeholder="0x..." />
      </label>

      <div id="prove-drop-zone" class="drop-zone" role="button" tabindex="0">
        Drop DEPOSIT file here or click to choose
      </div>
      <input id="prove-file-input" type="file" accept="application/json,.json" hidden />
      <section id="prove-loaded-summary" class="generated hidden">
        <h2>Summary</h2>
        <div class="generated-grid">
          <p><strong>Target</strong><span id="prove-summary-target"></span></p>
          <p><strong>Total</strong><span id="prove-summary-total"></span></p>
          <p><strong>File path</strong><span id="prove-summary-path"></span></p>
        </div>
      </section>

      <div id="prove-note-select-wrap" class="hidden">
        <h2>Select One Unclaimed Note</h2>
        <div id="prove-note-list"></div>
      </div>
      <section id="prove-command-wrap" class="generated hidden">
        <div class="command-head">
          <h2>Generate Proof Command</h2>
          <button id="prove-command-copy" class="link-btn tiny-btn" type="button">Copy</button>
        </div>
        <pre id="prove-command" class="output command-output"></pre>
      </section>

      <pre id="prove-output" class="output"></pre>
    </section>

    <section class="panel" id="tab-claim">
      <label>
        Shadow contract address
        <input id="claim-shadow-address" type="text" value="${DEFAULT_SHADOW_ADDRESS}" placeholder="0x..." />
      </label>

      <div id="claim-drop-zone" class="drop-zone" role="button" tabindex="0">
        Drop proof file here or click to choose
      </div>
      <input id="claim-file-input" type="file" accept="application/json,.json,.proof" hidden />

      <div class="cta-row">
        <button id="claim-connect" type="button">Connect Wallet</button>
        <button id="claim-submit" type="button" disabled>Claim</button>
      </div>

      <pre id="claim-output" class="output"></pre>
    </section>
  </main>
`;

const state = {
  wallet: {
    account: "",
    chainId: null
  },
  deposit: {
    chainId: HOODI_CHAIN_ID.toString(),
    isGenerating: false,
    generated: null,
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
    sufficientBalance: false
  },
  claim: {
    account: "",
    proofJson: null,
    proofPayload: null,
    proofFileName: ""
  }
};

bindTabs();
bindWallet();
bindDeposit();
bindProve();
bindClaim();
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
  const switchL2Btn = document.querySelector("#wallet-switch-l2");
  const switchL1Btn = document.querySelector("#wallet-switch-l1");

  connectBtn.addEventListener("click", async () => {
    try {
      await connectWallet();
    } catch (error) {
      setWalletStatus(`Wallet error: ${errorMessage(error)}`);
    }
  });

  switchL2Btn.addEventListener("click", async () => {
    try {
      await switchToHoodiL2();
    } catch (error) {
      setWalletStatus(`Switch error: ${errorMessage(error)}`);
    }
  });

  switchL1Btn.addEventListener("click", async () => {
    try {
      await switchToHoodiL1();
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
      maybeEnableDepositSendButton();
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
      maybeEnableDepositSendButton();
    })
    .catch(() => {
      updateWalletUi();
    });

  window.ethereum.on?.("accountsChanged", (accounts) => {
    state.wallet.account = accounts?.[0] ? normalizeAddress(accounts[0]) : "";
    state.claim.account = state.wallet.account;
    updateWalletUi();
    maybeEnableClaimButton();
    maybeEnableDepositSendButton();
  });

  window.ethereum.on?.("chainChanged", (chainIdHex) => {
    state.wallet.chainId = BigInt(chainIdHex);
    updateWalletUi();
    maybeEnableClaimButton();
    maybeEnableDepositSendButton();
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
  maybeEnableDepositSendButton();
}

async function switchToHoodiL2() {
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
  maybeEnableDepositSendButton();
}

async function switchToHoodiL1() {
  if (!window.ethereum) {
    throw new Error("No injected wallet detected. Install MetaMask or another EIP-1193 wallet.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_L1_CHAIN_HEX }]
    });
  } catch (error) {
    const code = Number(error?.code);
    if (code !== 4902) {
      throw error;
    }
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [HOODI_L1_CHAIN_PARAMS]
    });
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_L1_CHAIN_HEX }]
    });
  }

  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  state.wallet.chainId = BigInt(chainIdHex);
  updateWalletUi();
  maybeEnableClaimButton();
  maybeEnableDepositSendButton();
}

function updateWalletUi() {
  const connectBtn = document.querySelector("#wallet-connect");
  const switchL2Btn = document.querySelector("#wallet-switch-l2");
  const switchL1Btn = document.querySelector("#wallet-switch-l1");
  const status = document.querySelector("#wallet-status");

  if (!window.ethereum) {
    connectBtn.disabled = true;
    switchL2Btn.classList.add("hidden");
    switchL1Btn.classList.add("hidden");
    setWalletStatus("Wallet: not detected (install MetaMask)");
    return;
  }

  connectBtn.disabled = false;
  const account = state.wallet.account;
  const chainId = state.wallet.chainId;

  if (!account) {
    connectBtn.textContent = "Connect Wallet";
    switchL2Btn.classList.add("hidden");
    switchL1Btn.classList.add("hidden");
    setWalletStatus("Wallet: not connected");
    return;
  }

  const [first, last] = shortAddressParts(account);
  connectBtn.textContent = "Wallet Connected";

  if (chainId && chainId !== HOODI_CHAIN_ID) switchL2Btn.classList.remove("hidden");
  else switchL2Btn.classList.add("hidden");
  if (chainId && chainId !== HOODI_L1_CHAIN_ID) switchL1Btn.classList.remove("hidden");
  else switchL1Btn.classList.add("hidden");

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
  const sendEtherBtn = document.querySelector("#deposit-send-ether");
  const resetBtn = document.querySelector("#deposit-reset");
  const saveAsBtn = document.querySelector("#deposit-save-as");

  addNoteBtn.addEventListener("click", () => {
    if (state.deposit.isGenerating || state.deposit.generated) return;
    if (state.deposit.notes.length >= MAX_NOTES) {
      setDepositOutput(`Maximum ${MAX_NOTES} notes allowed.`);
      return;
    }
    state.deposit.notes.push(newNote(state.deposit.nextNoteId));
    state.deposit.nextNoteId += 1;
    renderDepositNotes();
  });

  sendEtherBtn.addEventListener("click", async () => {
    try {
      if (!state.deposit.generated) {
        throw new Error("Generate deposit first.");
      }
      if (!state.wallet.account) {
        throw new Error("Connect wallet first.");
      }
      if (state.wallet.chainId !== HOODI_L1_CHAIN_ID) {
        throw new Error(`Switch wallet to Hoodi L1 (${HOODI_L1_CHAIN_ID.toString()}) first.`);
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
      maybeEnableDepositSendButton();
    }
  });

  saveAsBtn.addEventListener("click", async () => {
    try {
      const generated = state.deposit.generated;
      if (!generated?.depositJson) {
        throw new Error("Generate deposit file first.");
      }
      const savedName = await saveDepositFileAs(generated);
      if (savedName) {
        state.deposit.generated.filePath = savedName;
        renderDepositGenerated();
      }
      clearDepositOutput();
    } catch (error) {
      if (error?.name === "AbortError") {
        clearDepositOutput();
        return;
      }
      setDepositOutput(errorMessage(error));
    }
  });

  resetBtn.addEventListener("click", () => {
    state.deposit.generated = null;
    state.deposit.tx = null;
    state.deposit.isGenerating = false;
    renderDepositGenerated();
    renderDepositNotes();
    maybeEnableDepositSendButton();
    clearDepositOutput();
  });

  generateBtn.addEventListener("click", async () => {
    if (state.deposit.generated) return;
    generateBtn.disabled = true;
    addNoteBtn.disabled = true;
    state.deposit.isGenerating = true;
    renderDepositNotes();
    maybeEnableDepositSendButton();
    try {
      setDepositOutput("Generating PoW-valid secret and building deposit...");
      const built = await buildDepositPayload(state.deposit, {
        minePowSecret: true,
        onMiningProgress: (attempts) => {
          setDepositOutput(
            `Generating PoW-valid secret and building deposit... attempts: ${attempts.toLocaleString()}`
          );
        }
      });
      const stamp = timestampForFilename();
      const [first, last] = shortAddressParts(built.targetAddress);
      const fileName = `deposit-${first}-${last}-${stamp}.json`;
      const filePath = `Downloads/${fileName}`;

      downloadJson(fileName, built.depositJson);
      state.deposit.generated = {
        fileName,
        filePath,
        targetAddress: built.targetAddress,
        totalWei: built.totalWei,
        depositJson: built.depositJson
      };
      state.deposit.tx = null;
      renderDepositGenerated();
      clearDepositOutput();
    } catch (error) {
      setDepositOutput(errorMessage(error));
    } finally {
      state.deposit.isGenerating = false;
      renderDepositNotes();
      addNoteBtn.disabled = Boolean(state.deposit.generated);
      generateBtn.disabled = false;
      maybeEnableDepositSendButton();
    }
  });
}

function renderDepositNotes() {
  const container = document.querySelector("#deposit-note-list");
  container.innerHTML = "";

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
      });
    });

    row.querySelector("button").addEventListener("click", (event) => {
      if (!canRemove) return;
      const idx = Number(event.target.dataset.index);
      state.deposit.notes.splice(idx, 1);
      renderDepositNotes();
    });

    container.appendChild(row);
  });
}

function renderDepositGenerated() {
  const generatedWrap = document.querySelector("#deposit-generated");
  const actionsWrap = document.querySelector("#deposit-generated-actions");
  const generateRow = document.querySelector("#deposit-generate-row");
  const addNoteBtn = document.querySelector("#deposit-add-note");
  const generated = state.deposit.generated;
  addNoteBtn.disabled = state.deposit.isGenerating || Boolean(generated);

  if (!generated) {
    generatedWrap.classList.add("hidden");
    actionsWrap.classList.add("hidden");
    generateRow.classList.remove("hidden");
    document.querySelector("#deposit-generated-target").textContent = "";
    document.querySelector("#deposit-generated-total").textContent = "";
    document.querySelector("#deposit-generated-path").textContent = "";
    document.querySelector("#deposit-save-as").disabled = true;
    updateDepositTxUi();
    return;
  }

  generatedWrap.classList.remove("hidden");
  actionsWrap.classList.remove("hidden");
  generateRow.classList.add("hidden");
  document.querySelector("#deposit-generated-target").textContent = generated.targetAddress;
  document.querySelector("#deposit-generated-total").textContent =
    `${generated.totalWei.toString()} wei (${formatEther(generated.totalWei)} ETH)`;
  document.querySelector("#deposit-generated-path").textContent = generated.filePath;
  document.querySelector("#deposit-save-as").disabled = false;
  updateDepositTxUi();
  maybeEnableDepositSendButton();
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

  if (tx.chainId === HOODI_CHAIN_ID) {
    link.classList.remove("hidden");
    link.href = `https://hoodi.taikoscan.io/tx/${tx.hash}`;
    link.textContent = "View transaction (L2)";
  } else {
    // L1 explorer URL is not configured; show status with the tx hash instead.
    link.classList.add("hidden");
    link.href = "#";
  }

  const chainLabel =
    tx.chainId === HOODI_L1_CHAIN_ID ? "L1" : tx.chainId === HOODI_CHAIN_ID ? "L2" : "tx";
  const hashSuffix = tx.chainId === HOODI_L1_CHAIN_ID ? ` (${tx.hash})` : "";

  if (tx.status === "confirmed") {
    status.textContent = `${chainLabel} Confirmed${hashSuffix}`;
  } else if (tx.status === "failed") {
    status.textContent = `${chainLabel} Failed${hashSuffix}`;
  } else {
    status.textContent = `${chainLabel} Confirming...${hashSuffix}`;
  }
}

function maybeEnableDepositSendButton() {
  const btn = document.querySelector("#deposit-send-ether");
  if (!btn) return;

  const hasGenerated = Boolean(state.deposit.generated);
  const walletReady = Boolean(state.wallet.account) && state.wallet.chainId === HOODI_L1_CHAIN_ID;
  const txPending = state.deposit.tx?.status === "pending";
  const txConfirmed = state.deposit.tx?.status === "confirmed";
  btn.disabled = !(hasGenerated && walletReady) || txPending || txConfirmed;
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
        updateDepositTxUi();
        maybeEnableDepositSendButton();
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

  const validateLoadedDeposit = async (options = {}) => {
    if (!state.prove.depositJson) {
      throw new Error("Load a DEPOSIT file first.");
    }

    setOutput("prove-output", "Validating deposit...");
    state.prove.selectedNoteIndex = null;
    state.prove.noteStatuses = [];
    state.prove.sufficientBalance = false;
    state.prove.commandText = "";
    state.prove.validationStamp = "";
    renderProveCommand();
    noteSelectWrap.classList.add("hidden");

    const rpcRaw = document.querySelector("#prove-rpc").value.trim();
    if (!rpcRaw) throw new Error("L2 RPC URL is required.");
    const rpcUrl = normalizeRpcUrl(rpcRaw);

    const l1RpcRaw = document.querySelector("#prove-l1-rpc").value.trim();
    if (!l1RpcRaw) throw new Error("L1 RPC URL is required.");
    const l1RpcUrl = normalizeRpcUrl(l1RpcRaw);

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
      throw new Error(`Only Hoodi (167013) is supported. Resolved chainId=${resolvedChainId.toString()}`);
    }

    const l1ChainId = await fetchChainId(l1RpcUrl);
    if (l1ChainId !== HOODI_L1_CHAIN_ID) {
      throw new Error(
        `L1 chainId mismatch: expected=${HOODI_L1_CHAIN_ID.toString()} rpc=${l1ChainId.toString()}`
      );
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
    const l1Balance = await fetchBalanceWei(l1RpcUrl, derived.targetAddress);
    const sufficientBalance = l1Balance >= derived.totalAmount;

    state.prove.targetAddress = derived.targetAddress;
    state.prove.totalAmount = derived.totalAmount;
    state.prove.resolvedChainId = resolvedChainId;
    state.prove.sufficientBalance = sufficientBalance;

    if (!sufficientBalance) {
      setOutput(
        "prove-output",
        [
          `Target address: ${derived.targetAddress}`,
          `Resolved L2 chainId: ${resolvedChainId.toString()}`,
          `L1 balance: ${l1Balance.toString()} wei (${formatEther(l1Balance)} ETH)`,
          `Required: ${derived.totalAmount.toString()} wei (${formatEther(derived.totalAmount)} ETH)`,
          "Balance sufficient: no"
        ].join("\n")
      );
      return;
    }

    const shadowAddressRaw = document.querySelector("#prove-shadow-address").value.trim();
    const shadowAddress = shadowAddressRaw ? normalizeAddress(shadowAddressRaw) : "";

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
      `Resolved L2 chainId: ${resolvedChainId.toString()}`,
      `L1 balance: ${l1Balance.toString()} wei (${formatEther(l1Balance)} ETH)`,
      `Required: ${derived.totalAmount.toString()} wei (${formatEther(derived.totalAmount)} ETH)`,
      `Balance sufficient: ${sufficientBalance ? "yes" : "no"}`,
      shadowAddress
        ? `Unclaimed notes: ${unclaimedCount}/${noteStatuses.length} (on-chain checked)`
        : `Unclaimed notes: ${unclaimedCount}/${noteStatuses.length} (assumed, no Shadow contract provided)`
    ];

    setOutput("prove-output", lines.join("\n"));
    if (sufficientBalance && unclaimedCount > 0 && state.prove.selectedNoteIndex !== null) {
      state.prove.commandText = buildProveCommand(state.prove.selectedNoteIndex);
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

function buildProveCommand(noteIndex) {
  const rpcRaw = document.querySelector("#prove-rpc").value.trim();
  const rpcUrl = normalizeRpcUrl(rpcRaw);
  const l1RpcRaw = document.querySelector("#prove-l1-rpc").value.trim();
  const l1RpcUrl = l1RpcRaw ? normalizeRpcUrl(l1RpcRaw) : HOODI_L1_RPC_URL;
  const [first, last] = shortAddressParts(state.prove.targetAddress);
  const stamp = state.prove.validationStamp || timestampForFilename();
  const proofFileName = `deposit-${first}-${last}-${stamp}-${noteIndex}.proof.json`;
  const depositFilePath = shellQuote(state.prove.depositFilePath || state.prove.depositFileName || "deposit.json");

  return [
    "# Run from repo root (shadow-gpt).",
    "# Groth16 receipts require Docker (risc0-groth16 shrinkwrap).",
    "node packages/risc0-prover/scripts/shadowcli.mjs prove \\",
    `  --deposit ${depositFilePath} \\`,
    `  --rpc "${rpcUrl}" \\`,
    `  --l1-rpc "${l1RpcUrl}" \\`,
    `  --note-index ${noteIndex} \\`,
    "  --receipt-kind groth16 \\",
    `  --proof-out "${proofFileName}"`
  ].join("\n");
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
    const item = document.createElement("label");
    item.className = "note-choice";
    item.innerHTML = `
      <span class="note-choice-content">
        #${note.index} • ${formatEther(note.amountWei)} ETH (${note.amountWei.toString()} wei)
        <small>Recipient: ${note.recipient}</small>
      </span>
      <input type="radio" name="prove-note" value="${note.index}" ${note.index === state.prove.selectedNoteIndex ? "checked" : ""} />
    `;

    item.querySelector("input").addEventListener("change", () => {
      state.prove.selectedNoteIndex = note.index;
      state.prove.commandText = buildProveCommand(note.index);
      renderProveCommand();
    });

    list.appendChild(item);
  });
}

function bindClaim() {
  wireDropZone({
    zone: document.querySelector("#claim-drop-zone"),
    fileInput: document.querySelector("#claim-file-input"),
    onFile: async (file) => {
      try {
        const parsed = await readJsonFile(file);
        const prepared = prepareClaimPayload(parsed);
        const grossWei = prepared.claimInput.amount;
        const feeWei = grossWei / 1000n;
        const netWei = grossWei - feeWei;
        const proofBytes = hexDataByteLength(prepared.proof);
        state.claim.proofJson = parsed;
        state.claim.proofPayload = prepared;
        state.claim.proofFileName = file.name;
        maybeEnableClaimButton();
        setOutput(
          "claim-output",
          [
            `Loaded proof file: ${file.name}`,
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

      const shadowAddress = normalizeAddress(
        document.querySelector("#claim-shadow-address").value.trim()
      );

      const walletChainId = BigInt(await window.ethereum.request({ method: "eth_chainId" }));
      const proofChainId = state.claim.proofPayload.chainId;
      if (walletChainId !== HOODI_CHAIN_ID) {
        throw new Error(`Only Hoodi (167013) is supported. Wallet chainId is ${walletChainId.toString()}.`);
      }
      if (proofChainId !== HOODI_CHAIN_ID) {
        throw new Error(`Only Hoodi (167013) proofs are supported. Proof chainId is ${proofChainId.toString()}.`);
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
                  { name: "blockNumber", type: "uint48" },
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

  document.querySelector("#claim-shadow-address").addEventListener("input", () => {
    maybeEnableClaimButton();
  });
}

function maybeEnableClaimButton() {
  const hasContract = Boolean(document.querySelector("#claim-shadow-address").value.trim());
  const onSupportedChain = state.wallet.chainId === HOODI_CHAIN_ID;
  document.querySelector("#claim-submit").disabled = !(
    hasContract &&
    state.claim.proofPayload &&
    state.claim.account &&
    onSupportedChain
  );
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

  if (blockNumber > (1n << 48n) - 1n) {
    throw new Error("blockNumber exceeds uint48 range");
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
  const value = proof?.risc0?.proof ?? proof?.proofHex ?? proof?.risc0?.proofHex;
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid proof file: missing valid proof bytes (risc0.proof or proofHex)");
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

    const mined = await minePowValidSecret(notesHash, options.onMiningProgress);
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

async function minePowValidSecret(notesHash, onProgress) {
  let attempts = 0;

  while (true) {
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
