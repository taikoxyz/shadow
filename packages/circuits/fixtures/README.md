# Shadow Circuit Fixtures

This directory contains pre-generated data sets that are used by the Vitest suites
and integration tooling.  The goal is to keep a handful of deterministic fixtures
under version control so local contributors do not need to hit an Ethereum node
in order to compile or run the circuits.

## Layout

```
fixtures/
├── mainnet/
│   ├── block-19000000.json      # Block header snapshot
│   └── account-vitalik.json     # Account proof snapshot
└── mock/
    ├── simple-account.json      # Minimal valid account proof
    └── invalid-proof.json       # Intentionally malformed proof
```

The `mainnet` files are expected to be sourced from an archival Ethereum RPC.
The fixtures are generated from a live JSON-RPC endpoint so the parsing logic
is exercised against real data. Regenerate the snapshots via
`scripts/generate-fixtures.ts` when you have RPC access.

## Regenerating

```
cd packages/circuits
ETH_RPC_URL="https://rpc.example" \
NETWORK="holesky" \
BLOCK_NUMBER="latest" \
ACCOUNT_ADDRESS="0xYourAddress" \
node scripts/generate-fixtures.mjs
```

> **NOTE**: The generation script is best-effort and should never be invoked
> from CI.  It performs live JSON-RPC requests and will overwrite the files in
> this directory.
