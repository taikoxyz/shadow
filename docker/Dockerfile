# =============================================================================
# Shadow Protocol — Containerized Local Architecture
# =============================================================================
# Single Docker image that provides:
# - Rust backend server (Axum) with REST API + WebSocket
# - In-process ZK proof generation (no Docker-in-Docker)
# - Local web UI served by the backend
# - Workspace-based file management via bind-mounted host directory
#
# NOTE: RISC Zero only publishes x86_64 Linux toolchain binaries, so this
# image must be built for linux/amd64. On Apple Silicon, use:
#   docker build --platform linux/amd64 -f docker/Dockerfile -t shadow-local .
# =============================================================================

# Pin all stages to linux/amd64 — RISC Zero only ships x86_64 toolchain binaries.
# Using ARG avoids the "constant value" lint warning from BuildKit.
ARG TARGETPLATFORM=linux/amd64

# -----------------------------------------------------------------------------
# Stage 1: UI Builder — compile the frontend with Vite
# -----------------------------------------------------------------------------
FROM --platform=${TARGETPLATFORM} node:20-bookworm AS ui-builder

WORKDIR /build

# Install pnpm
RUN npm install -g pnpm@9

# Copy UI package files for dependency installation
COPY packages/ui/package.json ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy UI source and build
COPY packages/ui/ ./
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 2: Rust Builder — compile the server binary with proof generation
# -----------------------------------------------------------------------------
FROM --platform=${TARGETPLATFORM} rust:bookworm AS rust-builder

ENV CARGO_BUILD_JOBS=0
ENV CMAKE_BUILD_PARALLEL_LEVEL=0

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      pkg-config \
      libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Install RISC Zero toolchain
RUN cargo install rzup --locked
RUN for i in 1 2 3 4 5; do \
      echo "Attempt $i: Installing RISC Zero toolchain..." && \
      rzup install && break || \
      (echo "Attempt $i failed, retrying in 10s..." && sleep 10); \
    done

WORKDIR /build

# Copy Rust source (risc0-prover workspace + server)
COPY packages/risc0-prover/ ./packages/risc0-prover/
COPY packages/server/ ./packages/server/

# Build the server binary with proof generation enabled
RUN cargo build \
      --release \
      --manifest-path packages/server/Cargo.toml \
      --features prove

# Also build the CLI host binary (useful for standalone proof generation)
RUN cargo build \
      --release \
      --manifest-path packages/risc0-prover/Cargo.toml \
      -p shadow-risc0-host

# -----------------------------------------------------------------------------
# Stage 3: Runtime — minimal image with server + UI + prover
# -----------------------------------------------------------------------------
FROM --platform=${TARGETPLATFORM} debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy RISC Zero toolchain (needed for local proving).
# rzup installs r0vm and extensions into ~/.risc0; we also look for r0vm in
# ~/.cargo/bin (some rzup versions place it there).
COPY --from=rust-builder /root/.risc0 /root/.risc0
RUN mkdir -p /root/.cargo/bin && \
    if [ -f /root/.risc0/bin/r0vm ]; then \
      ln -sf /root/.risc0/bin/r0vm /root/.cargo/bin/r0vm; \
    fi

# Copy server binary
COPY --from=rust-builder /build/packages/server/target/release/shadow-server /app/shadow-server

# Copy CLI binary
COPY --from=rust-builder /build/packages/risc0-prover/target/release/shadow-risc0-host /app/shadow-risc0-host

# Copy built UI assets
COPY --from=ui-builder /build/dist /app/ui

# Set up PATH
ENV PATH="/root/.cargo/bin:/root/.risc0/bin:/app:${PATH}"

# Use local prover (no Docker-in-Docker)
ENV RISC0_PROVER=local

# Metadata labels
LABEL org.opencontainers.image.title="Shadow Protocol"
LABEL org.opencontainers.image.description="Privacy-preserving ETH claims on Taiko with local ZK proof generation"
LABEL org.opencontainers.image.source="https://github.com/taikoxyz/shadow"
LABEL org.opencontainers.image.vendor="Taiko"

# Circuit ID and chain metadata (update when deploying new versions)
# These labels help identify which on-chain verifier this image is compatible with.
# "Circuit ID" is the RISC Zero guest program hash — not to be confused with Docker image digest.
LABEL org.taikoxyz.shadow.circuit-id="0x90c445f6632e0b603305712aacf0ac4910a801b2c1aa73749d12c08319d96844"
LABEL org.taikoxyz.shadow.chain-id="167013"

EXPOSE 3000

ENTRYPOINT ["/app/shadow-server"]
CMD ["--workspace", "/workspace", "--port", "3000", "--ui-dir", "/app/ui"]
