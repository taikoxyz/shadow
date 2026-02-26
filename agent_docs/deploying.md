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

## Verify on Taikoscan (Etherscan-compatible)

```bash
forge verify-contract <CONTRACT_ADDRESS> src/impl/Shadow.sol:Shadow \
  --chain-id 167013 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.hoodi.taikoscan.io/api
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
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url https://api.hoodi.taikoscan.io/api
```

## Notes

- Taiko is a Type-1 zkEVM — standard Solidity deploys without modification
- Testnet ETH: get Hoodi ETH from `hoodi.ethpandaops.io`, bridge to Taiko via the Taiko bridge
