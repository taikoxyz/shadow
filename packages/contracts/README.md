# Shadow Contracts

## Commands
- `pnpm contracts:test` – runs `forge test -vvv` using pnpm-managed dependencies
- `pnpm contracts:fmt` – formats Solidity sources via `forge fmt`
- `forge script script/DeployTaiko.s.sol:DeployTaiko --rpc-url <RPC> --broadcast` – deploys and wires the full stack

## Directory Structure
- `src/iface/` – Interface contracts (IShadow, IShadowVerifier, etc.)
- `src/impl/` – Implementation contracts (Shadow, ShadowVerifier, ...)
- `src/lib/` – Shared helpers (public input parsing)
- `script/` – Foundry deployment scripts
- `test/` – Test files
- `test/mocks/` – Mock implementations for hermetic testing

## Components

### Core Implementations (`src/impl/`)
- **`Shadow`**: Claim contract with immutable dependencies (verifier, ETH minter hook, feeRecipient). Tracks consumed nullifiers internally. Applies a 0.1% claim fee (`amount / 1000`).
- **`ShadowVerifier`**: Wrapper that checks state roots before dispatching to the circuit verifier.
- **`Risc0CircuitVerifier`**: ICircuitVerifier adapter that binds public inputs to a RISC0 journal and delegates receipt-seal validation to a RISC0 verifier contract.
- **`DummyEtherMinter`**: No-op minter used in local/testing deployments; emits `EthMinted(recipient, amount)`.

### Interfaces (`src/iface/`)
- `IShadow`, `IShadowVerifier` – Core protocol interfaces
- `IEthMinter`, `ICircuitVerifier` – External dependency interfaces

### Public input layout
- `packages/docs/public-inputs-spec.md` – Full specification including public input encoding and RISC0 journal binding.

### Testing
Mocks for every interface live under `test/mocks` to keep integration tests hermetic. Upgradeable contracts are tested behind ERC1967Proxy to ensure proper initialization behavior.

## RISC0 proof payload format

`Risc0CircuitVerifier.verify` expects `_proof` to be ABI-encoded as:

- `abi.encode(bytes seal, bytes32 journalDigest)`

Where `journalDigest = sha256(journal)`. The journal itself is not passed on-chain.

The on-chain verification flow:
1. `Shadow.claim(_proof, _input)` validates inputs and passes to `ShadowVerifier`
2. `ShadowVerifier.verifyProof` fetches the block hash from `TaikoAnchor`, builds the public inputs array, and delegates to `Risc0CircuitVerifier`
3. `Risc0CircuitVerifier.verify` decodes the seal and journalDigest from `_proof`, then calls `IRiscZeroVerifier.verify(seal, imageId, journalDigest)`

Private inputs enforced inside the zkVM guest (not in the journal):
- `noteIndex`, `powDigest`, secret, and Merkle proof data

## Taiko deployment script

`script/DeployTaiko.s.sol` deploys, initializes, and wires:

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

forge script script/DeployTaiko.s.sol:DeployTaiko \
  --rpc-url "$RPC_URL" \
  --broadcast
```

## TaikoScan verification (Etherscan v2 API)

Taiko Hoodi is indexed by TaikoScan (Etherscan). The API uses the Etherscan v2 endpoint:

- `https://api.etherscan.io/v2/api?chainid=167013`

When verifying via API, `chainid` must be in the **query string** (not in the POST body).
