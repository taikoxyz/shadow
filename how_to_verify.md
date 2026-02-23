# How to Verify Contracts on Taiko Hoodi

## Current Status

The Taikoscan API (Etherscan-compatible) is experiencing issues with the V2 migration. Automated verification via `forge verify-contract` is currently blocked.

## Deployed Contracts (Feb 23, 2026)

| Contract | Address |
|----------|---------|
| DummyEtherMinter | `0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9` |
| Risc0CircuitVerifier | `0x1e3e9D95233Cce7544F8986660738497eF373997` |
| ShadowVerifier | `0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96` |
| Shadow (implementation) | `0x7eC396B34df5c64A371512b25c680699eD5BB5e5` |
| Shadow (proxy) | `0xCd45084D91bC488239184EEF39dd20bCb710e7C2` |

## Method 1: Manual Verification via Taikoscan Web UI

1. Go to [Taikoscan Hoodi](https://hoodi.taikoscan.io)
2. Navigate to the contract address
3. Click "Contract" tab → "Verify & Publish"
4. Select:
   - Compiler Type: `Solidity (Standard-Json-Input)`
   - Compiler Version: `0.8.33`
   - License: `MIT`
5. Generate Standard JSON input:
   ```bash
   cd packages/contracts
   forge verify-contract <ADDRESS> <CONTRACT_PATH>:<CONTRACT_NAME> \
     --show-standard-json-input > standard-input.json
   ```
6. Upload `standard-input.json` to the web form
7. For contracts with constructor args, provide them in ABI-encoded format

### Constructor Arguments

**Risc0CircuitVerifier:**
```
Constructor: (address verifier_, bytes32 imageId_)
Values: (0xd1934807041B168f383870A0d8F565aDe2DF9D7D, 0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8)
ABI-encoded:
000000000000000000000000d1934807041b168f383870a0d8f565ade2df9d7d37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8
```

**ShadowVerifier:**
```
Constructor: (address anchor_, address circuitVerifier_)
Values: (0x1670130000000000000000000000000000010001, 0x1e3e9D95233Cce7544F8986660738497eF373997)
ABI-encoded:
0000000000000000000000001670130000000000000000000000000000100010000000000000000000000001e3e9d95233cce7544f8986660738497ef373997
```

**Shadow:**
```
Constructor: (address verifier_, address etherMinter_, address feeRecipient_)
Values: (0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96, 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9, 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb)
ABI-encoded:
0000000000000000000000000b98084bd3e775d0c5fa61c9e59383d7b7a45b9600000000000000000000000071f360597bbdb01ca24a70d9d4abb3bb5ef5e8d9000000000000000000000000e36c0f16d5fb473cc5181f5fb86b6eb3299ad9cb
```

**ERC1967Proxy (Shadow proxy):**
```
Constructor: (address implementation, bytes data)
Implementation: 0x7eC396B34df5c64A371512b25c680699eD5BB5e5
Data: initialize(address) with 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb
```

## Method 2: Automated Verification (When API Works)

### Taikoscan (Etherscan-compatible)

```bash
# Set API key
export ETHERSCAN_API_KEY=7BKJ18BYCTWPAXRNUXGZNQIUFVPIET67HA

# Verify DummyEtherMinter (no constructor args)
forge verify-contract 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
  src/impl/DummyEtherMinter.sol:DummyEtherMinter \
  --chain-id 167013 \
  --verifier-url https://api-hoodi.taikoscan.io/api \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --watch

# Verify Risc0CircuitVerifier (with constructor args)
forge verify-contract 0x1e3e9D95233Cce7544F8986660738497eF373997 \
  src/impl/Risc0CircuitVerifier.sol:Risc0CircuitVerifier \
  --chain-id 167013 \
  --verifier-url https://api-hoodi.taikoscan.io/api \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,bytes32)" \
    0xd1934807041B168f383870A0d8F565aDe2DF9D7D \
    0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8) \
  --watch

# Verify ShadowVerifier
forge verify-contract 0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96 \
  src/impl/ShadowVerifier.sol:ShadowVerifier \
  --chain-id 167013 \
  --verifier-url https://api-hoodi.taikoscan.io/api \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" \
    0x1670130000000000000000000000000000010001 \
    0x1e3e9D95233Cce7544F8986660738497eF373997) \
  --watch

# Verify Shadow implementation
forge verify-contract 0x7eC396B34df5c64A371512b25c680699eD5BB5e5 \
  src/impl/Shadow.sol:Shadow \
  --chain-id 167013 \
  --verifier-url https://api-hoodi.taikoscan.io/api \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
    0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96 \
    0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
    0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb) \
  --watch
```

### Blockscout (Alternative)

```bash
# Blockscout doesn't require API key
forge verify-contract 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
  src/impl/DummyEtherMinter.sol:DummyEtherMinter \
  --chain-id 167013 \
  --verifier blockscout \
  --verifier-url https://blockscout.hoodi.taiko.xyz/api \
  --watch
```

## Known Issues

1. **V1 API Deprecation**: Taikoscan is migrating to V2 API. The error "You are using a deprecated V1 endpoint" appears when using `--verifier-url https://api-hoodi.taikoscan.io/api`.

2. **Sourcify Not Supported**: Chain 167013 is not currently supported by Sourcify for verification.

3. **Blockscout 404**: The Blockscout API endpoint for Taiko Hoodi may return 404 errors.

## Workaround

Until API issues are resolved, use the **manual web UI verification** method on [Taikoscan Hoodi](https://hoodi.taikoscan.io).

## Generating Standard JSON Input

For complex contracts or when web UI requires it:

```bash
cd packages/contracts

# Generate for any contract
forge verify-contract <ADDRESS> <PATH>:<NAME> --show-standard-json-input > standard-input.json

# Example
forge verify-contract 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
  src/impl/DummyEtherMinter.sol:DummyEtherMinter \
  --show-standard-json-input > DummyEtherMinter-standard-input.json
```

Upload this JSON file directly to the Taikoscan verification page.
