# Shadow E2E Testing (Local Docker)

## Prerequisites

- Docker Desktop installed and running
- On Apple Silicon: enable Rosetta emulation (Settings > General > "Use Rosetta for x86_64/amd64 emulation on Apple Silicon")
- A funded wallet on Taiko Hoodi (chain ID 167013)
- `cast` CLI (from Foundry) for on-chain transactions

## 1. Build the Docker image

```bash
cd /Users/d/Projects/taiko/shadow

docker build \
  --platform linux/amd64 \
  -f docker/Dockerfile \
  -t shadow-local \
  .
```

First build takes a while (RISC Zero toolchain + Rust compilation). Subsequent builds use layer cache.

## 2. Create a workspace directory

```bash
mkdir -p workspace
```

## 3. Run the container

```bash
docker run --rm -it \
  --platform linux/amd64 \
  -p 3000:3000 \
  -v $(pwd)/workspace:/workspace \
  -e RPC_URL=https://rpc.hoodi.taiko.xyz \
  -e SHADOW_ADDRESS=0x77cdA0575e66A5FC95404fdA856615AD507d8A07 \
  -e RECEIPT_KIND=groth16 \
  -e RUST_LOG=shadow_server=info \
  shadow-local
```

Wait for `listening on 0.0.0.0:3000` in the logs, then open http://localhost:3000.

## 4. Mine a new deposit

**UI:** Click "+ New Deposit", fill in recipient and amount (wei), click "Mine Deposit".

**curl:**

```bash
curl -X POST http://localhost:3000/api/deposits \
  -H 'Content-Type: application/json' \
  -d '{
    "chainId": "167013",
    "notes": [{
      "recipient": "0xYOUR_ADDRESS",
      "amount": "1000000000000000",
      "label": "test note"
    }]
  }'
```

Takes 3-10 seconds. Note the `targetAddress` in the response.

## 5. Fund the target address

Send ETH to the `targetAddress`. Total must cover all notes plus 0.1% fee.

For a 0.001 ETH note, send at least `1001000000000000` wei:

```bash
cast send <targetAddress> \
  --value 1001000000000000 \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0xYOUR_PRIVATE_KEY
```

## 6. Generate a proof

**UI:** Open the deposit detail page, click "Generate Proof".

**curl:**

```bash
curl -X POST http://localhost:3000/api/deposits/<DEPOSIT_ID>/prove
```

Monitor progress in the container logs:

```bash
docker logs -f shadow
```

Groth16 proving takes several minutes depending on hardware.

## 7. Claim on-chain

**UI:** Connect MetaMask (Taiko Hoodi, chain 167013), click "Claim" next to the note.

**curl + cast:**

```bash
# Get claim calldata
curl http://localhost:3000/api/deposits/<DEPOSIT_ID>/notes/0/claim-tx
# Returns: { "to": "0x77cd...", "data": "0x...", "chainId": "0x28c55" }

# Submit the transaction
cast send <to> --data <data> \
  --rpc-url https://rpc.hoodi.taiko.xyz \
  --private-key 0xYOUR_PRIVATE_KEY
```

## 8. Verify the claim

```bash
curl -X POST http://localhost:3000/api/deposits/<DEPOSIT_ID>/notes/0/refresh
```

Status should change to `claimed`.

## Useful commands

| Command | Purpose |
|---------|---------|
| `./start.sh` | Pull/build + run |
| `./start.sh --clean` | Remove images and containers |
| `docker logs -f shadow` | Tail logs |
| `docker stop shadow` | Stop |
| `curl localhost:3000/api/health` | Health check |
| `curl localhost:3000/api/config` | Server config |
| `curl localhost:3000/api/deposits` | List deposits |
| `curl localhost:3000/api/queue` | Proof queue status |

## Troubleshooting

- **Build fails on Apple Silicon**: Enable Rosetta in Docker Desktop settings.
- **Proof OOM**: Allocate at least 8 GB RAM to Docker (Settings > Resources).
- **Port 3000 refused**: Wait for the server to finish starting.
- **Deposits not visible**: Check the workspace bind mount path and permissions.
