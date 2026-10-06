# Chambers — the Company.md control plane (apps/api) for Railway (https://api.comd.fun, *.sites.comd.fun).
# One Node process runs HTTP + WS /agent, the scheduler, attester and settler, and calls @company/services in-process
# (the Clerk re-runs seat work with Foundry, the Records Office publishes with git, the Registrar runs forge scripts).
# So this image carries git, Foundry (forge/cast/anvil, pinned via npm) and a pre-fetched solc 0.8.26.
#
#   docker build -f infra/docker/api.Dockerfile -t comd-api .
#   docker run -p 8787:8787 -v comd-data:/data comd-api        # GET /health
#
# Storage: Railway volume mounted at /data (STORAGE_DRIVER=local, STORAGE_DIR=/data/storage, the default here) or an
# S3-compatible bucket (STORAGE_DRIVER=s3 + S3_*). No Pinata/IPFS. Do not add a VOLUME instruction: Railway rejects
# it; attach the volume in the Railway UI instead.

ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------------------------------------------ os + toolchain
FROM ${NODE_IMAGE} AS os
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# git: Records Office (publishRepo) + Foundry libs; util-linux: unshare for Clerk sandboxes; tini: PID 1 that reaps
# the forge/npm children the Clerk spawns.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl util-linux tini \
 && rm -rf /var/lib/apt/lists/*

# Foundry from npm (pinnable, checksummed by the npm lockfile of the global install). The npm `forge` entry is a
# Node wrapper; link the native binaries straight onto PATH instead.
ARG FOUNDRY_VERSION=1.7.1
RUN npm install -g @foundry-rs/forge@${FOUNDRY_VERSION} @foundry-rs/cast@${FOUNDRY_VERSION} @foundry-rs/anvil@${FOUNDRY_VERSION} \
 && root="$(npm root -g)" \
 && for t in forge cast anvil; do \
      bin="$(find "$root/@foundry-rs/$t" -type f -path "*/@foundry-rs/$t-linux-*/bin/$t" | head -n1)"; \
      if [ ! -x "$bin" ]; then echo "native $t binary not found under $root/@foundry-rs/$t" >&2; exit 1; fi; \
      ln -sf "$bin" "/usr/local/bin/$t"; \
    done \
 && forge --version && cast --version && anvil --version \
 && npm cache clean --force

# solc 0.8.26 in svm's layout (~/.svm/<v>/solc-<v>), so `solc_version = "0.8.26"` resolves without network (Clerk
# sandboxes run forge --offline). amd64: the official static build from GitHub releases, sha256-pinned. Other
# architectures: let forge/svm fetch it during the probe build below.
ARG SOLC_VERSION=0.8.26
ARG SOLC_SHA256=d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef
RUN set -eu; arch="$(dpkg --print-architecture)"; dir="/root/.svm/${SOLC_VERSION}"; mkdir -p "$dir"; \
    if [ "$arch" = "amd64" ]; then \
      curl -fsSL -o "$dir/solc-${SOLC_VERSION}" "https://github.com/ethereum/solidity/releases/download/v${SOLC_VERSION}/solc-static-linux"; \
      echo "${SOLC_SHA256}  $dir/solc-${SOLC_VERSION}" | sha256sum -c -; \
      chmod +x "$dir/solc-${SOLC_VERSION}"; offline="--offline"; \
    else offline=""; fi; \
    mkdir -p /tmp/probe/src; cd /tmp/probe; \
    printf '[profile.default]\nsolc_version = "%s"\nevm_version = "cancun"\n' "${SOLC_VERSION}" > foundry.toml; \
    printf '// SPDX-License-Identifier: MIT\npragma solidity %s;\ncontract Probe { function v() external pure returns (uint256) { return 1; } }\n' "${SOLC_VERSION}" > src/Probe.sol; \
    forge build $offline; \
    test -x "$dir/solc-${SOLC_VERSION}"; \
    cd /; rm -rf /tmp/probe

ENV FORGE_BIN=/usr/local/bin/forge \
    SOLC_BIN=/root/.svm/0.8.26/solc-0.8.26 \
    SANDBOX_NET=env

# ------------------------------------------------------------------------------------------------ manifests only
# Copy just the package manifests so `npm ci` stays cached until a package.json or the lockfile changes.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN mkdir -p /manifests \
 && cp --parents package.json package-lock.json packages/*/package.json apps/*/package.json /manifests/

# ------------------------------------------------------------------------------------------------ build
FROM os AS build
WORKDIR /app
COPY --from=manifests /manifests/ ./
RUN npm ci
COPY . .
# @company/art: dist/ is the package entry (another builder owns its build script; skip quietly if it is missing).
RUN npm run build -w @company/art --if-present
# @company/protocol runs from src/ (type stripping). @company/abi exports src/*.ts but imports siblings as "./x.js"
# (bundler style), which plain node cannot resolve: emit sibling .js files in the image (sources untouched).
RUN npm run build -w @company/abi --if-present && node infra/docker/emit-js.mjs packages/abi
RUN npm run build -w @company/services && npm run build -w @company/api
# Assemble what the runtime needs, without node_modules (re-installed below with --omit=dev).
RUN mkdir -p /out \
 && tar -c --exclude=node_modules --exclude=.next --exclude='*.tsbuildinfo' \
      packages/protocol packages/services packages/art packages/abi apps/api skills \
    | tar -x -C /out

# ------------------------------------------------------------------------------------------------ runtime
FROM os AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    STORAGE_DRIVER=local \
    STORAGE_DIR=/data/storage \
    SKILLS_DIR=/app/skills
COPY --from=manifests /manifests/ ./
# Production deps of the api and the workspaces it imports at runtime only (no Next.js / wagmi / esbuild).
RUN npm ci --omit=dev \
      -w @company/api -w @company/protocol -w @company/services -w @company/art -w @company/abi \
 && npm cache clean --force
COPY --from=build /out/ ./
COPY infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
# fail the build (not the deploy) if a runtime workspace import cannot load under plain node
RUN chmod +x /usr/local/bin/api-entrypoint \
 && node -e "Promise.all(['@company/protocol','@company/abi','@company/services','@company/art'].map(m => import(m))).then(() => console.log('workspace imports ok'))"

EXPOSE 8787
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/api-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
