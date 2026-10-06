#!/usr/bin/env bash
# Full local demo of Company.md: anvil (chain id 46630) → contracts (Deploy.s.sol) → 100% of COMD seeded into the
# Chambers (apps/api) → website. Pons mode: no own pool; MockComd stands in for the Pons token.
#
#   scripts/local-stack.sh                    # everything; Ctrl+C stops it all
#   scripts/local-stack.sh --contracts-only   # anvil + deploy, print addresses, stop anvil
#   scripts/local-stack.sh --no-web           # anvil + contracts + api
#
# Env:
#   FORGE / ANVIL / CAST   binaries (default: from PATH)
#   FOUNDRY_PROFILE        e.g. "local" for the offline sandbox profile in contracts/foundry.toml
#   ANVIL_PORT=8545 API_PORT=8787 WEB_PORT=3000
#   STACK_DIR=.local-stack (logs, env files, deployment json, blob storage)
#
# Everything is written under $STACK_DIR. The deploy writes contracts/deployments/46630.json and
# contracts/broadcast/Deploy.s.sol/46630/; both are moved into $STACK_DIR and any pre-existing (real testnet) copies
# are restored, so a local run never clobbers the testnet address book.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE="${FORGE:-$(command -v forge || true)}"
ANVIL="${ANVIL:-$(command -v anvil || true)}"
CAST="${CAST:-$(command -v cast || true)}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
STACK_DIR="${STACK_DIR:-$ROOT/.local-stack}"
CHAIN_ID=46630
# the profile only matters to forge in contracts/; cast/anvil elsewhere would warn about it
DEPLOY_PROFILE="${FOUNDRY_PROFILE:-default}"; unset FOUNDRY_PROFILE
RPC="http://127.0.0.1:$ANVIL_PORT"

MODE=all
for a in "$@"; do
  case "$a" in
    --contracts-only) MODE=contracts ;;
    --no-web) MODE=api ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done

for b in FORGE ANVIL CAST; do
  [ -n "${!b}" ] && [ -x "${!b}" ] || { echo "$b not found: install Foundry or set $b=/path/to/binary"; exit 2; }
done

log() { printf '\033[1m[local-stack]\033[0m %s\n' "$*"; }
mkdir -p "$STACK_DIR"
printf '*\n' > "$STACK_DIR/.gitignore"   # env files, logs and dev keys never get committed
PIDS=()
set -m
cleanup() {
  # job control (set -m) puts every background service in its own process group: kill the group so the
  # npm/tsx/next grandchildren go too
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && { kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true; }; done
  sleep 1
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -KILL -- "-$p" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for() { # name cmd timeout_s [pid that must stay alive]
  local i
  for ((i = 0; i < $3; i++)); do
    if eval "$2" >/dev/null 2>&1; then return 0; fi
    if [ -n "${4:-}" ] && ! kill -0 "$4" 2>/dev/null; then log "$1 exited"; return 1; fi
    sleep 1
  done
  log "$1 did not come up in $3 s"; return 1
}

# Well-known anvil dev accounts (mnemonic "test test … junk"); NEVER use these anywhere else.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # account 0
ATTESTER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d   # account 1
DEPLOYER_ADDR="$("$CAST" wallet address --private-key "$DEPLOYER_KEY")"

# --------------------------------------------------------------------------------------------- 1. contracts libs
if [ ! -d "$ROOT/contracts/lib/forge-std" ] || [ ! -d "$ROOT/contracts/lib/v4-core" ]; then
  log "installing pinned contract libs"
  bash "$ROOT/scripts/install-contract-libs.sh"
fi

# --------------------------------------------------------------------------------------------- 2. anvil
if "$CAST" chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  log "something already listens on $RPC; stop it or set ANVIL_PORT"; exit 1
fi
log "starting anvil --chain-id $CHAIN_ID on :$ANVIL_PORT (log $STACK_DIR/anvil.log)"
"$ANVIL" --chain-id "$CHAIN_ID" --port "$ANVIL_PORT" --silent > "$STACK_DIR/anvil.log" 2>&1 &
PIDS+=($!)
wait_for anvil "\"$CAST\" chain-id --rpc-url $RPC" 30 "$!"
[ "$("$CAST" chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { log "anvil chain id mismatch"; exit 1; }

# --------------------------------------------------------------------------------------------- 3. deploy
DEP_JSON="$ROOT/contracts/deployments/$CHAIN_ID.json"
BC_DIR="$ROOT/contracts/broadcast/Deploy.s.sol/$CHAIN_ID"
BACKUP="$STACK_DIR/.backup"
rm -rf "$BACKUP"; mkdir -p "$BACKUP" "$ROOT/contracts/deployments"
[ -f "$DEP_JSON" ] && cp "$DEP_JSON" "$BACKUP/deployment.json"
[ -d "$BC_DIR" ] && cp -R "$BC_DIR" "$BACKUP/broadcast"
restore() {
  rm -f "$DEP_JSON"; rm -rf "$BC_DIR"
  [ -f "$BACKUP/deployment.json" ] && cp "$BACKUP/deployment.json" "$DEP_JSON"
  [ -d "$BACKUP/broadcast" ] && mkdir -p "$(dirname "$BC_DIR")" && cp -R "$BACKUP/broadcast" "$BC_DIR"
  rm -rf "$BACKUP"
}

log "deploying contracts (forge script Deploy.s.sol, profile $DEPLOY_PROFILE; log $STACK_DIR/deploy.log)"
set +e
(
  cd "$ROOT/contracts"
  env FOUNDRY_PROFILE="$DEPLOY_PROFILE" DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" ADMIN="$DEPLOYER_ADDR" \
      COUNSEL_BASE_URI="http://localhost:$API_PORT/agents/by-token/" \
      "$FORGE" script script/Deploy.s.sol:Deploy --rpc-url "$RPC" --broadcast --slow
) > "$STACK_DIR/deploy.log" 2>&1
rc=$?
set -e
if [ $rc -ne 0 ] || [ ! -f "$DEP_JSON" ]; then
  restore; tail -40 "$STACK_DIR/deploy.log"; log "deploy failed (exit $rc)"; exit 1
fi
mkdir -p "$STACK_DIR/deployments"; cp "$DEP_JSON" "$STACK_DIR/deployments/$CHAIN_ID.json"; cp "$DEP_JSON" "$STACK_DIR/deployments.json"
rm -rf "$STACK_DIR/broadcast"; mkdir -p "$STACK_DIR/broadcast/Deploy.s.sol"; cp -R "$BC_DIR" "$STACK_DIR/broadcast/Deploy.s.sol/$CHAIN_ID"
restore

COUNSEL="$(node -p "require('$STACK_DIR/deployments.json').counselNFT")"
# Open a free public mint locally (price 0 is the contract default) so the mint page works in the demo.
"$CAST" send "$COUNSEL" 'setPhase(uint8)' 2 --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null
# Robinhood Chain (like most chains) has Multicall3 at 0xcA11…CA11 and the site batches reads through it; anvil
# does not, so place it (viem ships its bytecode): deploy once, copy the runtime code to the canonical address.
MC3_CODE="$(node -e "const s=require('fs').readFileSync('$ROOT/node_modules/viem/_esm/constants/contracts.js','utf8');process.stdout.write(/multicall3Bytecode\s*=\s*'(0x[0-9a-f]+)'/.exec(s)[1])")"
MC3_TMP="$("$CAST" send --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" --json --create "$MC3_CODE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).contractAddress))")"
"$CAST" rpc anvil_setCode 0xcA11bde05977b3631167028862bE2a173976CA11 "$("$CAST" code "$MC3_TMP" --rpc-url "$RPC")" --rpc-url "$RPC" >/dev/null
# Pons mode: $COMD is Pons's token on real chains; here Deploy.s.sol deployed a MockComd stand-in and the deployer
# holds all 1B. The Flywheel's swapper stays unconfigured until a pool exists, exactly as before the Pons graduation.
log "deployed; Counsel phase 2 (public, free). Addresses: $STACK_DIR/deployments.json"
cat "$STACK_DIR/deployments.json"; echo

# --------------------------------------------------------------------------------------------- 4. env files
node "$ROOT/scripts/deployment-env.mjs" "$CHAIN_ID" --deployments "$STACK_DIR/deployments" --broadcast "$STACK_DIR/broadcast" --only api > "$STACK_DIR/api.env"
cat >> "$STACK_DIR/api.env" <<EOF

# local stack
PORT=$API_PORT
HOST=127.0.0.1
NODE_ENV=development
RPC_URL=$RPC
LAUNCH_CHAINS=$CHAIN_ID
PUBLIC_API_URL=http://localhost:$API_PORT
PUBLIC_WEB_URL=http://localhost:$WEB_PORT
ALLOWED_ORIGINS=http://localhost:$WEB_PORT
SITES_DOMAIN=sites.localhost
STORAGE_DRIVER=local
STORAGE_DIR=$STACK_DIR/storage
ATTESTER_PRIVATE_KEY=$ATTESTER_KEY
# the deployer is also the KEEPER here (Deploy.s.sol defaults KEEPER to ADMIN): hook flush, Flywheel buyback,
# RevenueRouter.distribute
KEEPER_PRIVATE_KEY=$DEPLOYER_KEY
KEEPER_DISTRIBUTE_MIN_COMD=1
CONTACT_EMAIL=team@comd.fun
# no Permit2 on a fresh anvil: accept signed payments without moving funds
PAYMENTS_MODE=mock
SANDBOX_NET=env
FORGE_BIN=$FORGE
EOF
node "$ROOT/scripts/deployment-env.mjs" "$CHAIN_ID" --deployments "$STACK_DIR/deployments" --broadcast "$STACK_DIR/broadcast" --only web > "$STACK_DIR/web.env"
cat >> "$STACK_DIR/web.env" <<EOF

# local stack
NEXT_PUBLIC_API_URL=http://localhost:$API_PORT
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_MOCK=0
NEXT_PUBLIC_SITES_DOMAIN=sites.localhost
EOF
log "wrote $STACK_DIR/api.env and $STACK_DIR/web.env"

if [ "$MODE" = contracts ]; then log "--contracts-only: stopping anvil"; exit 0; fi

# --------------------------------------------------------------------------------------------- 5. api
log "starting Chambers on :$API_PORT (log $STACK_DIR/api.log)"
bash -c 'set -a; . "$1"; set +a; cd "$2"; exec npm run dev -w @company/api' _ "$STACK_DIR/api.env" "$ROOT" > "$STACK_DIR/api.log" 2>&1 &
PIDS+=($!)
wait_for api "curl -fsS http://127.0.0.1:$API_PORT/health" 90 "$!" || { tail -30 "$STACK_DIR/api.log"; exit 1; }
log "api healthy: http://localhost:$API_PORT/health"

# --------------------------------------------------------------------------------------------- 6. web
if [ "$MODE" = all ]; then
  log "starting the website on :$WEB_PORT (log $STACK_DIR/web.log)"
  bash -c 'set -a; . "$1"; set +a; cd "$2"; exec npx --no-install next dev -p "$3"' _ "$STACK_DIR/web.env" "$ROOT/apps/web" "$WEB_PORT" > "$STACK_DIR/web.log" 2>&1 &
  PIDS+=($!)
  wait_for web "curl -fsS -o /dev/null http://127.0.0.1:$WEB_PORT/" 180 "$!" || { tail -30 "$STACK_DIR/web.log"; exit 1; }
  log "web up: http://localhost:$WEB_PORT"
fi

cat <<EOF

  anvil   $RPC  (chain $CHAIN_ID; dev account 0 = deployer/admin $DEPLOYER_ADDR)
  api     http://localhost:$API_PORT/health
  web     http://localhost:$WEB_PORT
  worker  npm run comd -w @company/worker -- start --server http://localhost:$API_PORT --runtime mock

Ctrl+C stops everything.
EOF
wait
