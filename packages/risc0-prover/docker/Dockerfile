FROM node:20-bookworm

ENV PNPM_HOME=/root/.pnpm
ENV PATH="/root/.cargo/bin:/root/.risc0/bin:${PNPM_HOME}:${PATH}"
ENV CARGO_BUILD_JOBS=1
ENV CMAKE_BUILD_PARALLEL_LEVEL=1

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

RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
RUN cargo install rzup --locked
RUN arch=$(uname -m) && \
    if [ "$arch" = "aarch64" ]; then \
      rzup install rust --platform x86_64-unknown-linux-gnu && \
      rzup install risc0-groth16 --platform x86_64-unknown-linux-gnu; \
    else \
      rzup install; \
    fi
RUN npm install -g pnpm@9

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages

RUN pnpm install --filter shadow-risc0-prover... --frozen-lockfile --ignore-scripts --force
RUN cargo build --manifest-path packages/risc0-prover/Cargo.toml --release -p shadow-risc0-host

COPY docker/prover/entrypoint.sh /workspace/docker/prover/entrypoint.sh
RUN chmod +x /workspace/docker/prover/entrypoint.sh

ENTRYPOINT ["/workspace/docker/prover/entrypoint.sh"]
