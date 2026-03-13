# Shadow Contracts

## Commands
- `pnpm contracts:test` – runs `forge test -vvv` using pnpm-managed dependencies
- `pnpm contracts:fmt` – formats Solidity sources via `forge fmt`
- `pnpm contracts:layout` – regenerates `*_Layout.sol` storage layout docs for proxy contracts
- `forge script script/DeployHoodi.s.sol:DeployHoodi --rpc-url <RPC> --broadcast` – deploys and wires the full stack on Hoodi

## Directory Structure
- `src/iface/` – Interface contracts (IShadow, IShadowVerifier, etc.)
- `src/impl/` – Implementation contracts (Shadow, ShadowVerifier, ...)
- `src/lib/` – Shared helpers (public input parsing)
- `script/` – Foundry deployment scripts
- `test/` – Test files
- `test/mocks/` – Mock implementations for hermetic testing

## Components

### Core Implementations (`src/impl/`)
- **`Shadow`**: Claim contract with immutable dependencies (verifier, ETH minter hook, feeRecipient). Tracks consumed nullifiers internally. Applies a 0.1% claim fee (`amount / 1000`). Supports both ETH and ERC20 claims — branches on `_input.token == address(0)`.
- **`ShadowVerifier`**: Wrapper that checks state roots before dispatching to the circuit verifier.
- **`Risc0CircuitVerifier`**: ICircuitVerifier adapter that binds public inputs to a RISC0 journal (136 bytes) and delegates receipt-seal validation to a RISC0 verifier contract.
- **`DummyEtherMinter`**: No-op minter used in local/testing deployments; emits `EthMinted(recipient, amount)`.
- **`ShadowCompatibleERC20`**: Abstract base for ERC20 tokens supporting Shadow transfers. Implements `IShadowCompatibleToken` on top of OpenZeppelin ERC20. Tokens inherit this and configure their `_BALANCE_SLOT`.
- **`TestShadowToken`**: Concrete test ERC20 for Hoodi (`_BALANCE_SLOT = 0`). Exposes `devMint()` for testing.

### Interfaces (`src/iface/`)
- `IShadow`, `IShadowVerifier` – Core protocol interfaces
- `IEthMinter`, `ICircuitVerifier` – External dependency interfaces
- `IShadowCompatibleToken` – Interface for ERC20 tokens supporting Shadow transfers. Requires `shadowMint()`, `balanceStorageSlot()`, `balanceSlot()`, and `maxShadowMintAmount()`.

### Public input layout
- `packages/docs/public-inputs-spec.md` – Full specification including public input encoding and RISC0 journal binding.

### Testing
Mocks for every interface live under `test/mocks` to keep integration tests hermetic. Upgradeable contracts are tested behind ERC1967Proxy to ensure proper initialization behavior.

## RISC0 proof payload format

`Risc0CircuitVerifier.verify` expects `_proof` to be ABI-encoded as:

- `abi.encode(bytes seal, bytes32 journalDigest)`

Where `journalDigest = sha256(journal)`. The journal itself is not passed on-chain.

The journal is **136 bytes** with the following layout:

| Offset | Size | Field | Encoding |
|--------|------|-------|----------|
| 0 | 8 | blockNumber | uint64 LE |
| 8 | 32 | blockHash | bytes32 |
| 40 | 8 | chainId | uint64 LE |
| 48 | 16 | amount | uint128 LE |
| 64 | 20 | recipient | bytes20 |
| 84 | 32 | nullifier | bytes32 |
| 116 | 20 | token | bytes20, all-zeros = ETH |

The on-chain verification flow:
1. `Shadow.claim(_proof, _input)` validates inputs and passes to `ShadowVerifier`
2. `ShadowVerifier.verifyProof` fetches the block hash from `TaikoAnchor`, builds the 107-element public inputs array, and delegates to `Risc0CircuitVerifier`
3. `Risc0CircuitVerifier.verify` decodes the seal and journalDigest from `_proof`, then calls `IRiscZeroVerifier.verify(seal, imageId, journalDigest)`
4. `Shadow.claim` branches on `_input.token`: `address(0)` → `etherMinter.mintEth()`; otherwise → `IShadowCompatibleToken(token).shadowMint()`

Private inputs enforced inside the zkVM guest (not in the journal):
- `noteIndex`, secret, and Merkle proof data
- `targetAddress` (never appears in the journal, calldata, or events)

**Claim ABI:** `claim(bytes,(uint64,uint64,uint256,address,bytes32,address))`

## Hoodi deployment script

`script/DeployHoodi.s.sol` deploys, initializes, and wires:

1. `DummyEtherMinter`
2. `Risc0CircuitVerifier`
3. `ShadowVerifier`
4. `Shadow` implementation (with immutable `feeRecipient = owner`) + `ERC1967Proxy` initialized with `initialize(owner)`

Required environment variables:

- `DEPLOYER_PRIVATE_KEY`
- `OWNER` (Shadow owner / final governance owner)
- `ANCHOR`
- `IMAGE_ID` (optional; RISC0 method image id as `bytes32`, defaults to hoodi image id)

Optional environment variables:

- none

Example:

```bash
export RPC_URL="https://rpc.hoodi.taiko.xyz"
export DEPLOYER_PRIVATE_KEY="0x..."
export OWNER="0x..."
export ANCHOR="0x..."
export IMAGE_ID="0x..."

forge script script/DeployHoodi.s.sol:DeployHoodi \
  --rpc-url "$RPC_URL" \
  --broadcast
```

## TaikoScan verification (Etherscan v2 API)

Taiko Hoodi is indexed by TaikoScan (Etherscan). The API uses the Etherscan v2 endpoint:

- `https://api.etherscan.io/v2/api?chainid=167013`

When verifying via API, `chainid` must be in the **query string** (not in the POST body).
