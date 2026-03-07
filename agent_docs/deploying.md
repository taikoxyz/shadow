# Deploying Shadow Contracts

## Networks at a Glance

| Network | Chain ID | RPC | Explorer |
|---------|----------|-----|----------|
| Taiko Mainnet | `167000` | `https://rpc.mainnet.taiko.xyz` | `https://taikoscan.io/` |
| Taiko Hoodi (testnet) | `167013` | `https://rpc.hoodi.taiko.xyz` | `https://hoodi.taikoscan.io/` |

---

## Deploying to Taiko Mainnet

### Key Addresses

| Contract | Address |
|----------|---------|
| TaikoAnchor | `0x1670000000000000000000000000000000010001` |
| TaikoBridge (IEthMinter) | `0x1670000000000000000000000000000000000001` |
| L2 Delegate Controller (proxy owner) | `0xfA06E15B8b4c5BF3FC5d9cfD083d45c53Cbe8C7C` |
| Taiko Labs multisig (fee recipient) | `0xB73b0FC4C0Cfc73cF6e034Af6f6b42Ebe6c8b49D` |
| RISC0 Groth16 Verifier | deploy with `DeployMainnetRisc0Verifier.s.sol` (see below) |

### Environment Variables

- `DEPLOYER_KEY` — Private key for deploying contracts
- `ETHERSCAN_API_KEY` — API key for contract verification on Taikoscan
- `RISC0_VERIFIER` — Address of the deployed `RiscZeroGroth16Verifier` (**required**)
- `IMAGE_ID` — ZK circuit image ID (**required** — get from `shadow-risc0-host circuit-id`)
- `OWNER` — Owner address (defaults to `L2_DELEGATE_CONTROLLER`)
- `FEE_RECIPIENT` — Fee recipient address (defaults to `TAIKO_LABS`)

### Step 1: Deploy the RISC0 Groth16 Verifier

```bash
forge script script/DeployMainnetRisc0Verifier.s.sol:DeployMainnetRisc0Verifier \
  --rpc-url https://rpc.mainnet.taiko.xyz \
  --broadcast --verify \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167000&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY"
```

Record the printed `RiscZeroGroth16Verifier` address as `RISC0_VERIFIER`.

### Step 2: Deploy Shadow

```bash
RISC0_VERIFIER=0x<verifier-address> \
IMAGE_ID=0x<circuit-id> \
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url https://rpc.mainnet.taiko.xyz \
  --broadcast --verify \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167000&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY"
```

### Upgrade Image ID

```bash
RISC0_VERIFIER=0x<verifier-address> \
SHADOW_PROXY=0x<proxy-address> \
IMAGE_ID=0x<new-circuit-id> \
forge script script/UpgradeMainnetImageId.s.sol:UpgradeMainnetImageId \
  --rpc-url https://rpc.mainnet.taiko.xyz \
  --broadcast
```

### Verify Contracts Manually

```bash
# Risc0CircuitVerifier
forge verify-contract <ADDRESS> src/impl/Risc0CircuitVerifier.sol:Risc0CircuitVerifier \
  --chain-id 167000 \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167000&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address,bytes32)" 0xA5Da6507E6Ab8832EA3fDeB43bA6B7390952D8dA <IMAGE_ID>)

# ShadowVerifier
forge verify-contract <ADDRESS> src/impl/ShadowVerifier.sol:ShadowVerifier \
  --chain-id 167000 \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167000&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0x1670000000000000000000000000000000010001 <CIRCUIT_VERIFIER>)
```

---

## Deploying to Taiko Hoodi Testnet

## Network Details

| Field | Value |
|-------|-------|
| Chain ID | `167013` |
| RPC URL | `https://rpc.hoodi.taiko.xyz` |
| Block Explorer (Taikoscan) | `https://hoodi.taikoscan.io/` |
| Blockscout | `https://blockscout.hoodi.taiko.xyz/` |
| Blockscout API | `https://blockscoutapi.hoodi.taiko.xyz/api?` |
| L1 (Ethereum Hoodi) | Chain ID `560048`, `https://hoodi.etherscan.io/` |

## Environment Variables

- `DEPLOYER_KEY` — Private key for deploying contracts
- `ETHERSCAN_API_KEY` — API key for contract verification on Taikoscan

**Never hardcode these values.** Always read from environment.

## Deploy a Contract

```bash
forge create src/impl/Shadow.sol:Shadow \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key $DEPLOYER_KEY
```

## Verify on Taikoscan (recommended)

Taikoscan uses the Etherscan V2 unified API. Embed the chain ID and API key in the verifier URL:

```bash
forge verify-contract <CONTRACT_ADDRESS> src/impl/Shadow.sol:Shadow \
  --chain-id 167013 \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY"
```

For contracts with constructor arguments (e.g. `Risc0CircuitVerifier`):

```bash
forge verify-contract <CONTRACT_ADDRESS> src/impl/Risc0CircuitVerifier.sol:Risc0CircuitVerifier \
  --chain-id 167013 \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY" \
  --constructor-args $(cast abi-encode "constructor(address,bytes32)" <GROTH16_VERIFIER> <IMAGE_ID>)
```

## Verify on Blockscout

```bash
forge verify-contract <CONTRACT_ADDRESS> src/impl/Shadow.sol:Shadow \
  --verifier blockscout \
  --verifier-url 'https://blockscoutapi.hoodi.taiko.xyz/api?'
```

## Deploy + Verify in One Step

```bash
forge create src/impl/Shadow.sol:Shadow \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key $DEPLOYER_KEY \
  --verify \
  --verifier custom \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013&apikey=$ETHERSCAN_API_KEY" \
  --verifier-api-key "$ETHERSCAN_API_KEY"
```

## Check Verification Status

```bash
curl "https://api.etherscan.io/v2/api?chainid=167013&module=contract&action=checkverifystatus&guid=<GUID>&apikey=$ETHERSCAN_API_KEY"
```

## Deploy TestShadowToken (ERC20)

```bash
DEPLOYER_KEY=$DEPLOYER_KEY forge script script/DeployTestShadowToken.s.sol:DeployTestShadowToken \
  --rpc-url https://rpc.hoodi.taiko.xyz --broadcast -vvvv
```

The script deploys a `TestShadowToken` (TST) with 18 decimals and `maxShadowMintAmount = 100 ETH`.
After deploying, mint an initial supply to the deployer:

```bash
cast send <TOKEN_ADDRESS> "devMint(address,uint256)" <DEPLOYER_ADDRESS> 100000000000000000000000000 \
  --rpc-url https://rpc.hoodi.taiko.xyz --private-key $DEPLOYER_KEY
```

## Upgrade ImageId

When the ZK circuit changes, redeploy the verifier chain and upgrade the Shadow proxy:

```bash
DEPLOYER_KEY=$DEPLOYER_KEY IMAGE_ID=$(cargo run --manifest-path packages/risc0-prover/host/Cargo.toml -- circuit-id) \
  forge script script/UpgradeHoodiImageId.s.sol:UpgradeHoodiImageId \
  --rpc-url https://rpc.hoodi.taiko.xyz --broadcast -vvvv
```

## Notes

- Taiko is a Type-1 zkEVM — standard Solidity deploys without modification
- Testnet ETH: get Hoodi ETH from `hoodi.ethpandaops.io`, bridge to Taiko via the Taiko bridge
- `api.hoodi.taikoscan.io` does not have a DNS record; use `api.etherscan.io/v2/api?chainid=167013` instead
- `--verifier custom` is required (not `--verifier etherscan`) when using a custom URL; pass the API key in both the URL query string and `--verifier-api-key`
