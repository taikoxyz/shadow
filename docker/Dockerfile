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
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm@9

# Copy UI package files for dependency installation
COPY packages/ui/package.json ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy UI source and build
COPY packages/ui/ ./
RUN --mount=type=cache,target=/build/node_modules/.vite \
    pnpm build

# -----------------------------------------------------------------------------
# Stage 2: Rust Builder — compile the server binary with proof generation
# -----------------------------------------------------------------------------
FROM --platform=${TARGETPLATFORM} rust:bookworm AS rust-builder

# Use all available CPU cores for builds (cargo defaults to all CPUs when unset)
ENV CMAKE_BUILD_PARALLEL_LEVEL=0

# Install build dependencies
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      pkg-config \
      libssl-dev

# Install RISC Zero toolchain
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    cargo install rzup --locked
RUN for i in 1 2 3 4 5; do \
      echo "Attempt $i: Installing RISC Zero toolchain..." && \
      rzup install && break || \
      (echo "Attempt $i failed, retrying in 10s..." && sleep 10); \
    done

WORKDIR /build

# Copy Rust source (risc0-prover workspace + server)
COPY packages/risc0-prover/ ./packages/risc0-prover/
COPY packages/server/ ./packages/server/

# Build both binaries in a single step to share cache mounts and incremental state.
# Cache mounts persist cargo registry and build artifacts across Docker builds,
# so only changed source gets recompiled. The final binaries are copied to /tmp
# since cache mounts are not included in the image layer.
RUN --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    --mount=type=cache,target=/build/packages/server/target \
    --mount=type=cache,target=/build/packages/risc0-prover/target \
    cargo build \
      --release \
      --manifest-path packages/server/Cargo.toml \
      --features prove && \
    cp packages/server/target/release/shadow-server /tmp/shadow-server && \
    cargo build \
      --release \
      --manifest-path packages/risc0-prover/Cargo.toml \
      -p shadow-risc0-host && \
    cp packages/risc0-prover/target/release/shadow-risc0-host /tmp/shadow-risc0-host

# Extract circuit ID from the compiled binary
RUN /tmp/shadow-risc0-host circuit-id > /tmp/circuit-id.txt

# -----------------------------------------------------------------------------
# Stage 3: Runtime — minimal image with server + UI + prover
# -----------------------------------------------------------------------------
FROM --platform=${TARGETPLATFORM} debian:bookworm-slim

RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates

# Copy RISC Zero toolchain (needed for local proving).
# rzup installs r0vm and extensions into ~/.risc0; we also look for r0vm in
# ~/.cargo/bin (some rzup versions place it there).
COPY --from=rust-builder /root/.risc0 /root/.risc0
RUN mkdir -p /root/.cargo/bin && \
    if [ -f /root/.risc0/bin/r0vm ]; then \
      ln -sf /root/.risc0/bin/r0vm /root/.cargo/bin/r0vm; \
    fi

# Copy server binary
COPY --from=rust-builder /tmp/shadow-server /app/shadow-server

# Copy CLI binary
COPY --from=rust-builder /tmp/shadow-risc0-host /app/shadow-risc0-host

# Copy built UI assets
COPY --from=ui-builder /build/dist /app/ui

# Copy circuit ID from builder stage (used by start.sh to tag the image)
COPY --from=rust-builder /tmp/circuit-id.txt /tmp/circuit-id.txt

# Set up PATH
ENV PATH="/root/.cargo/bin:/root/.risc0/bin:/app:${PATH}"

# Use local prover (no Docker-in-Docker)
ENV RISC0_PROVER=local

# Metadata labels
LABEL org.opencontainers.image.title="Shadow Protocol"
LABEL org.opencontainers.image.description="Privacy-preserving ETH claims on Taiko with local ZK proof generation"
LABEL org.opencontainers.image.source="https://github.com/taikoxyz/shadow"
LABEL org.opencontainers.image.vendor="Taiko"

# Circuit ID is extracted dynamically into /tmp/circuit-id.txt during the build.
# It can be read via: docker run --rm --entrypoint cat <image> /tmp/circuit-id.txt
# Chain ID is determined at runtime from the RPC endpoint, not hardcoded.

EXPOSE 3000

ENTRYPOINT ["/app/shadow-server"]
CMD ["--workspace", "/workspace", "--port", "3000", "--ui-dir", "/app/ui"]
