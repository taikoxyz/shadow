# Deploying to Taiko Hoodi Testnet

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
