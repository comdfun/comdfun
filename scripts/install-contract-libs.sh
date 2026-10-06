#!/usr/bin/env bash
# Clone the pinned Foundry dependencies of contracts/ into contracts/lib (git-ignored).
# Pins are the ones in contracts/README.md ("Build and test"). Idempotent: a lib already at its pinned commit is
# left alone; one at another commit is re-fetched. Used by CI, the api Dockerfile and scripts/local-stack.sh.
#
#   scripts/install-contract-libs.sh            # into <repo>/contracts/lib
#   LIB_DIR=/somewhere/lib scripts/install-contract-libs.sh
#   FORCE=1 scripts/install-contract-libs.sh    # wipe and re-clone everything
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_DIR="${LIB_DIR:-$ROOT/contracts/lib}"
mkdir -p "$LIB_DIR"

# name | url | ref (tag or commit) | expected commit (empty = trust the tag) | submodules to init
LIBS=(
  # forge-std: the commit the contracts were tested with (c6fa5d8, "ci: migrate Foundry setup to shared action");
  # note the v1.17.0 tag itself points at f3dae6e.
  "forge-std|https://github.com/foundry-rs/forge-std|c6fa5d82a3a287c4ff23f26c8f7e2958aafd32d9|c6fa5d82a3a287c4ff23f26c8f7e2958aafd32d9|"
  "openzeppelin-contracts|https://github.com/OpenZeppelin/openzeppelin-contracts|v5.4.0|c64a1edb67b6e3f4a15cca8909c9482ad33a02b0|"
  "openzeppelin-contracts-upgradeable|https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable|v5.4.0|e725abddf1e01cf05ace496e950fc8e243cc7cab|"
  "v4-core|https://github.com/Uniswap/v4-core|46c6834698c48bc4a463a86d8420f4eb1d7f3b75|46c6834698c48bc4a463a86d8420f4eb1d7f3b75|lib/solmate"
  "erc-8004-contracts|https://github.com/erc-8004/erc-8004-contracts|b9e466c250744a7e06b13dff9d3c2844ed64f825|b9e466c250744a7e06b13dff9d3c2844ed64f825|"
)

log() { printf '[contract-libs] %s\n' "$*"; }

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

for entry in "${LIBS[@]}"; do
  IFS='|' read -r name url ref expect subs <<<"$entry"
  dir="$LIB_DIR/$name"
  want="${expect:-}"

  if [[ -z "${FORCE:-}" && -d "$dir/.git" ]]; then
    have="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
    if [[ -n "$want" && "$have" == "$want" ]] || [[ -z "$want" && -n "$have" ]]; then
      if [[ -n "$subs" ]]; then git -C "$dir" submodule update --init --depth 1 $subs >/dev/null 2>&1 || git -C "$dir" submodule update --init $subs; fi
      log "$name ok (${have:0:12})"
      continue
    fi
    log "$name at ${have:0:12}, want ${want:0:12}: re-fetching"
  fi

  rm -rf "$dir"
  if is_sha "$ref"; then
    # a bare commit: init + fetch that one commit shallowly (GitHub allows fetching reachable SHAs)
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
    if ! git -C "$dir" fetch -q --depth 1 origin "$ref"; then
      log "$name: shallow fetch of $ref refused, doing a full clone"
      rm -rf "$dir"; git clone -q "$url" "$dir"
    fi
    git -C "$dir" -c advice.detachedHead=false checkout -q "$ref" 2>/dev/null || git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  else
    git -c advice.detachedHead=false clone -q --depth 1 --branch "$ref" "$url" "$dir"
  fi

  if [[ -n "$subs" ]]; then
    git -C "$dir" submodule update --init --depth 1 $subs >/dev/null 2>&1 || git -C "$dir" submodule update --init $subs
  fi

  have="$(git -C "$dir" rev-parse HEAD)"
  if [[ -n "$want" && "$have" != "$want" ]]; then
    log "ERROR: $name resolved to $have, expected $want"
    exit 1
  fi
  log "$name installed (${have:0:12})"
done

log "done: $LIB_DIR"
