#!/usr/bin/env bash
# Deploy the Company.md contracts with contracts/script/Deploy.s.sol, regenerate @company/abi and print the env for
# the Railway services.  Testnet first; mainnet after the review in contracts/AUDIT.md.
#
#   DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… scripts/deploy-contracts.sh testnet      # chain 46630
#   DEPLOYER_PRIVATE_KEY=0x… ADMIN=0x… scripts/deploy-contracts.sh mainnet      # chain 4663
#
# Env: RPC_URL (default per network), DEPLOYER_PRIVATE_KEY (required), COMD_TOKEN (the $COMD address from Pons;
# required on mainnet, MockComd on testnet when unset), what Deploy.s.sol reads (ADMIN, TREASURY, SETTLER, KEEPER, REGISTRAR, POOL_MANAGER,
# SEAPORT, MAX_SWEEP_PRICE, COUNSEL_BASE_URI [https://api.comd.fun/agents/by-token/], ALLOW_ETH_PAIRING [false: launches
# pair with $COMD only], STAGE [full|mint], COUNSEL_NFT / IDENTITY_REGISTRY / REPUTATION_REGISTRY [reuse a mint-stage deploy]),
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
    printf '\nMainnet deployment. Type "deploy mainnet" to continue: '
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
echo "Next (DEPLOY.md): commit contracts/deployments/$CHAIN.json + packages/abi; set the printed variables on Railway;"
echo "after the Pons graduation call setPoolKey on the swapper. Every contract is owned by ADMIN already (nothing to"
echo "accept); the Counsel NFT is a UUPS proxy (counselNFT; implementation counselNFTImpl) upgradeable by ADMIN."

# sanity: the Counsel NFT proxy answers through its implementation and belongs to ADMIN
json="$ROOT/contracts/deployments/$CHAIN.json"
if [ -f "$json" ] && command -v jq >/dev/null; then
  nft="$(jq -r .counselNFT "$json")"; impl="$(jq -r .counselNFTImpl "$json")"
  slot="$("$CAST" storage "$nft" 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url "$RPC_URL")"
  [ "$(echo "0x${slot: -40}" | tr 'A-F' 'a-f')" = "$(echo "$impl" | tr 'A-F' 'a-f')" ] || { echo "WARNING: CounselNFT implementation slot does not match counselNFTImpl"; }
  [ "$("$CAST" call "$nft" 'name()(string)' --rpc-url "$RPC_URL" | tr -d '"')" = "Counsel" ] || echo "WARNING: CounselNFT name() != Counsel"
  if [ -n "${ADMIN:-}" ]; then
    [ "$("$CAST" call "$nft" 'owner()(address)' --rpc-url "$RPC_URL" | tr 'A-F' 'a-f')" = "$(echo "$ADMIN" | tr 'A-F' 'a-f')" ] || echo "WARNING: CounselNFT owner is not ADMIN"
  fi
fi
