# Taiko Hoodi Deployment / Proof Execution Report

## Requested actions
1. Redeploy contracts on Taiko Hoodi
2. Verify deployed contracts on TaikoScan/Etherscan
3. Create a deposit with 3 notes (note[0] != note[1])
4. Generate a real ZK proof and submit on-chain claim
5. Document all results (txs, addresses, proofs)

## Inputs used
- `DEPLOYER_PRIVATE_KEY`: present in environment
- `ETHERSCAN_API_KEY`: present in environment
- RPC target: `https://rpc.hoodi.taiko.xyz`
- Deposit file used: `packages/docs/data/deposits/hoodi-deposit-3-notes.json`

## Execution results

### 1) Deployment
Command:
```bash
cd packages/contracts && forge script script/DeployTaiko.s.sol:DeployTaiko --rpc-url https://rpc.hoodi.taiko.xyz --broadcast
```
Result:
- Failed: `forge` is not installed in this environment (`bash: command not found: forge`).
- No contracts were deployed.

### 2) Source verification
- Could not be executed because deployment did not run and Foundry verification tooling (`forge verify-contract`) is not available.
- No verification GUID/job IDs were produced.

### 3) Deposit with 3 notes
Created:
- `packages/docs/data/deposits/hoodi-deposit-3-notes.json`

Properties:
- `notes[0].recipient = 0x1111...1111`
- `notes[1].recipient = 0x2222...2222`
- `notes[2].recipient = 0x3333...3333`
- Note 0 and Note 1 are different, satisfying the request.

### 4) Prove / claim flow (real zk proof on-chain)
Validation command:
```bash
node packages/risc0-prover/scripts/shadowcli.mjs validate --deposit packages/docs/data/deposits/hoodi-deposit-3-notes.json --rpc https://rpc.hoodi.taiko.xyz
```
Result:
- Failed with `fetch failed` (RPC/network access from this environment failed).

Prove command:
```bash
node packages/risc0-prover/scripts/shadowcli.mjs prove --deposit packages/docs/data/deposits/hoodi-deposit-3-notes.json --rpc https://rpc.hoodi.taiko.xyz --proof-out packages/docs/data/deposits/hoodi-note-0.proof.json --receipt-kind groth16
```
Result:
- Failed with `fetch failed`.
- No proof JSON produced.

Claim command:
- Not attempted because proof generation failed and no deployed `Shadow` address exists from this run.

## Artifacts and values
- Deployment tx hashes: **N/A**
- Deployed contract addresses: **N/A**
- Verification links/job ids: **N/A**
- Proof artifact path: **N/A** (not generated)
- Claim tx hash: **N/A**

## Additional updates included
- Updated stale docs to match Anchor/blockHash flow:
  - `packages/contracts/README.md`
  - `packages/risc0-prover/README.md`
