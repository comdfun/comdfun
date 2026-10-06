#!/usr/bin/env bash
# Deploy the Company.md contracts with contracts/script/Deploy.s.sol, regenerate @company/abi and print the env for
# the Railway services.  UNAUDITED: testnet first; mainnet only after an outside audit.
#
#   DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… scripts/deploy-contracts.sh testnet      # chain 46630
#   DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… scripts/deploy-contracts.sh mainnet      # chain 4663
#
# Env: RPC_URL (default per network), DEPLOYER_PRIVATE_KEY (required), COMD_TOKEN (the $COMD address from Pons;
# required on mainnet, MockComd on testnet when unset), what Deploy.s.sol reads (ADMIN, TREASURY, SETTLER, KEEPER, REGISTRAR, POOL_MANAGER,
# SEAPORT, MAX_SWEEP_PRICE, COUNSEL_BASE_URI [https://api.comd.fun/agents/by-token/]),
# FORGE/CAST (binaries),
# FORGE_ARGS (extra flags, e.g. "--verify --verifier blockscout --verifier-url https://…/api/"),
# DRY_RUN=1 (simulate without --broadcast), CONFIRM_MAINNET=yes (skip the interactive prompt).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET="${1:-}"
case "$NET" in
  testnet) CHAIN=46630; DEFAULT_RPC=https://rpc.testnet.chain.robinhood.com ;;
  mainnet) CHAIN=4663;  DEFAULT_RPC=https://rpc.mainnet.chain.robinhood.com ;;
  *) echo "usage: $0 testnet|mainnet"; exit 2 ;;
esac
RPC_URL="${RPC_URL:-$DEFAULT_RPC}"
FORGE="${FORGE:-$(command -v forge || true)}"
CAST="${CAST:-$(command -v cast || true)}"
[ -x "$FORGE" ] && [ -x "$CAST" ] || { echo "forge/cast not found (install Foundry or set FORGE and CAST)"; exit 2; }
: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

got="$("$CAST" chain-id --rpc-url "$RPC_URL")"
[ "$got" = "$CHAIN" ] || { echo "RPC $RPC_URL is chain $got, expected $CHAIN"; exit 1; }
deployer="$("$CAST" wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
balance="$("$CAST" balance "$deployer" --rpc-url "$RPC_URL" --ether)"
echo "network  $NET ($CHAIN) via $RPC_URL"
echo "deployer $deployer ($balance ETH)"
echo "admin    ${ADMIN:-$deployer (default: deployer)}"

if [ "$NET" = mainnet ]; then
  echo; echo "== external address checklist"
  RPC_URL="$RPC_URL" CAST="$CAST" bash "$ROOT/scripts/check-mainnet-addresses.sh"
  if [ -z "${ADMIN:-}" ] || [ "$(echo "$ADMIN" | tr A-F a-f)" = "$(echo "$deployer" | tr A-F a-f)" ]; then
    echo "mainnet: set ADMIN to a multisig (not the deployer)"; exit 1
  fi
  [ -n "${COMD_TOKEN:-}" ] || { echo "mainnet: COMD_TOKEN (the \$COMD address from Pons) must be set"; exit 1; }
  for v in TREASURY SETTLER KEEPER REGISTRAR; do
    [ -n "${!v:-}" ] || { echo "mainnet: $v must be set explicitly"; exit 1; }
  done
  if [ "${CONFIRM_MAINNET:-}" != "yes" ]; then
    printf '\nThese contracts are UNAUDITED. Type "deploy mainnet" to continue: '
    read -r answer; [ "$answer" = "deploy mainnet" ] || { echo "aborted"; exit 1; }
  fi
fi

if [ ! -d "$ROOT/contracts/lib/forge-std" ]; then bash "$ROOT/scripts/install-contract-libs.sh"; fi

broadcast="--broadcast"; [ -n "${DRY_RUN:-}" ] && broadcast=""
echo; echo "== forge script Deploy.s.sol ${broadcast:-(dry run)}"
(cd "$ROOT/contracts" && "$FORGE" script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" $broadcast --slow ${FORGE_ARGS:-})

if [ -n "${DRY_RUN:-}" ]; then echo "dry run: nothing written"; exit 0; fi

echo; echo "== regenerate @company/abi"
node "$ROOT/packages/abi/scripts/gen-abi.mjs"

echo; echo "== Railway variables (paste into the api / web services)"
node "$ROOT/scripts/deployment-env.mjs" "$CHAIN"
echo
echo "Next (DEPLOY.md): commit contracts/deployments/$CHAIN.json + packages/abi; ADMIN accepts ownership of Flywheel;"
echo "set the printed variables on Railway; after the Pons graduation call setPoolKey on the swapper."
