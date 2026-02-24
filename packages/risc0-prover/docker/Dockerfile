# =============================================================================
# Taiko Shadow Prover - Docker Image
# =============================================================================
# Multi-stage build for generating ZK proofs on Taiko networks
# Supports: Mainnet (167000) and Hoodi Testnet (167013)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Compile Rust binaries and prepare Node.js dependencies
# -----------------------------------------------------------------------------
FROM node:20-bookworm AS builder

ENV PNPM_HOME=/root/.pnpm
ENV PATH="/root/.cargo/bin:/root/.risc0/bin:${PNPM_HOME}:${PATH}"
ENV CARGO_BUILD_JOBS=2
ENV CMAKE_BUILD_PARALLEL_LEVEL=2

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      gnupg \
      build-essential \
      pkg-config \
      libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Rust and RISC Zero toolchain
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
RUN cargo install rzup --locked
RUN arch=$(uname -m) && \
    if [ "$arch" = "aarch64" ]; then \
      rzup install rust --platform x86_64-unknown-linux-gnu && \
      rzup install risc0-groth16 --platform x86_64-unknown-linux-gnu; \
    else \
      rzup install; \
    fi

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /workspace

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

# Install Node.js dependencies
RUN pnpm install --filter shadow-risc0-prover... --frozen-lockfile --ignore-scripts --force

# Build Rust binary
RUN cargo build --manifest-path packages/risc0-prover/Cargo.toml --release -p shadow-risc0-host

# -----------------------------------------------------------------------------
# Stage 2: Runtime - Minimal image for running the prover
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV PNPM_HOME=/root/.pnpm
ENV PATH="/root/.cargo/bin:/root/.risc0/bin:${PNPM_HOME}:${PATH}"

# Install runtime dependencies only
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      gnupg && \
    rm -rf /var/lib/apt/lists/*

# Install Docker CLI (required for Groth16 proof generation)
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /workspace

# Copy built artifacts from builder stage
COPY --from=builder /workspace/packages/risc0-prover/target/release/shadow-risc0-host \
                    /workspace/packages/risc0-prover/target/release/shadow-risc0-host

# Copy RISC Zero toolchain from builder
COPY --from=builder /root/.risc0 /root/.risc0
COPY --from=builder /root/.cargo/bin /root/.cargo/bin

# Copy Node.js application and dependencies
COPY --from=builder /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=builder /workspace/packages ./packages
COPY --from=builder /workspace/node_modules ./node_modules

# Copy entrypoint script
COPY packages/risc0-prover/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Labels for container registry
LABEL org.opencontainers.image.title="Taiko Shadow Prover"
LABEL org.opencontainers.image.description="Generate ZK proofs for Shadow Protocol on Taiko networks"
LABEL org.opencontainers.image.source="https://github.com/aspect-build/shadow"
LABEL org.opencontainers.image.vendor="Aspect Build"

ENTRYPOINT ["/entrypoint.sh"]
