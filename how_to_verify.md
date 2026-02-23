# How to Verify Contracts on Taiko Hoodi

## Current Status

All contracts have been verified on Taikoscan using the **Etherscan V2 API**.

## Deployed & Verified Contracts (Feb 23, 2026)

| Contract | Address | Status |
|----------|---------|--------|
| DummyEtherMinter | [`0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9`](https://hoodi.taikoscan.io/address/0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9) | Verified |
| Risc0CircuitVerifier | [`0x1e3e9D95233Cce7544F8986660738497eF373997`](https://hoodi.taikoscan.io/address/0x1e3e9D95233Cce7544F8986660738497eF373997) | Verified |
| ShadowVerifier | [`0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96`](https://hoodi.taikoscan.io/address/0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96) | Verified |
| Shadow (implementation) | [`0x7eC396B34df5c64A371512b25c680699eD5BB5e5`](https://hoodi.taikoscan.io/address/0x7eC396B34df5c64A371512b25c680699eD5BB5e5) | Verified |
| Shadow (proxy) | [`0xCd45084D91bC488239184EEF39dd20bCb710e7C2`](https://hoodi.taikoscan.io/address/0xCd45084D91bC488239184EEF39dd20bCb710e7C2) | Verified |

---

## Method 1: Etherscan V2 API (Recommended)

The Etherscan V2 API works for Taiko Hoodi. Use the chainid query parameter format:

```bash
cd packages/contracts

# Set API key
export ETHERSCAN_API_KEY=7BKJ18BYCTWPAXRNUXGZNQIUFVPIET67HA
```

### Verify DummyEtherMinter (no constructor args)

```bash
forge verify-contract 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
  src/impl/DummyEtherMinter.sol:DummyEtherMinter \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --watch
```

### Verify Risc0CircuitVerifier

```bash
forge verify-contract 0x1e3e9D95233Cce7544F8986660738497eF373997 \
  src/impl/Risc0CircuitVerifier.sol:Risc0CircuitVerifier \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,bytes32)" \
    0xd1934807041B168f383870A0d8F565aDe2DF9D7D \
    0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8) \
  --watch
```

### Verify ShadowVerifier

```bash
forge verify-contract 0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96 \
  src/impl/ShadowVerifier.sol:ShadowVerifier \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" \
    0x1670130000000000000000000000000000010001 \
    0x1e3e9D95233Cce7544F8986660738497eF373997) \
  --watch
```

### Verify Shadow Implementation

```bash
forge verify-contract 0x7eC396B34df5c64A371512b25c680699eD5BB5e5 \
  src/impl/Shadow.sol:Shadow \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
    0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96 \
    0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9 \
    0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb) \
  --watch
```

### Verify ERC1967Proxy (Shadow Proxy)

```bash
# First, generate the init calldata
INIT_DATA=$(cast calldata "initialize(address)" 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb)

# Then verify with constructor args
forge verify-contract 0xCd45084D91bC488239184EEF39dd20bCb710e7C2 \
  node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=167013" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,bytes)" \
    0x7eC396B34df5c64A371512b25c680699eD5BB5e5 \
    "$INIT_DATA") \
  --watch
```

---

## Method 2: Manual Verification via Taikoscan Web UI

If automated verification fails, use the web UI:

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

---

## Constructor Arguments Reference

### Risc0CircuitVerifier
```
Constructor: (address verifier_, bytes32 imageId_)
Values: (0xd1934807041B168f383870A0d8F565aDe2DF9D7D, 0x37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8)
ABI-encoded:
000000000000000000000000d1934807041b168f383870a0d8f565ade2df9d7d37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8
```

### ShadowVerifier
```
Constructor: (address anchor_, address circuitVerifier_)
Values: (0x1670130000000000000000000000000000010001, 0x1e3e9D95233Cce7544F8986660738497eF373997)
ABI-encoded:
0000000000000000000000001670130000000000000000000000000000100010000000000000000000000001e3e9d95233cce7544f8986660738497ef373997
```

### Shadow
```
Constructor: (address verifier_, address etherMinter_, address feeRecipient_)
Values: (0x0B98084BD3e775d0c5Fa61C9E59383D7b7a45B96, 0x71f360597bbDB01CA24A70d9d4ABB3BB5EF5E8d9, 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb)
ABI-encoded:
0000000000000000000000000b98084bd3e775d0c5fa61c9e59383d7b7a45b9600000000000000000000000071f360597bbdb01ca24a70d9d4abb3bb5ef5e8d9000000000000000000000000e36c0f16d5fb473cc5181f5fb86b6eb3299ad9cb
```

### ERC1967Proxy (Shadow Proxy)
```
Constructor: (address implementation, bytes data)
Implementation: 0x7eC396B34df5c64A371512b25c680699eD5BB5e5
Data: initialize(address) with 0xe36C0F16d5fB473CC5181f5fb86b6Eb3299aD9cb
Init calldata: 0xc4d66de8000000000000000000000000e36c0f16d5fb473cc5181f5fb86b6eb3299ad9cb
```

---

## Important Notes

### V2 API Format

The key to successful verification is using the Etherscan V2 API format:

```
--verifier etherscan
--verifier-url "https://api.etherscan.io/v2/api?chainid=167013"
```

**NOT** the deprecated V1 format:
```
--verifier-url https://api-hoodi.taikoscan.io/api  # DEPRECATED
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "deprecated V1 endpoint" | Use V2 API URL with `?chainid=167013` |
| "cannot resolve file" | Use `node_modules/` path for OpenZeppelin contracts |
| Sourcify not supported | Use Etherscan V2 API instead |
| Blockscout 404 | Use Etherscan V2 API instead |

### API Key

Get your Etherscan/Taikoscan API key from the explorer settings. The same API key works for both V1 and V2 endpoints.
