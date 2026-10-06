#!/usr/bin/env bash
# Pre-deploy verification of the external addresses Company.md depends on (SPEC.md §1, contracts/README.md
# "External address verification checklist"). Read-only: eth_chainId, eth_getCode and a few view calls.
#
#   RPC_URL=https://rpc.mainnet.chain.robinhood.com scripts/check-mainnet-addresses.sh
#   EXPECT_CHAIN_ID=46630 RPC_URL=https://rpc.testnet.chain.robinhood.com scripts/check-mainnet-addresses.sh
#
# Exits non-zero if any required check fails. Override any address with its env name.
set -uo pipefail

CAST="${CAST:-$(command -v cast || true)}"
[ -x "$CAST" ] || { echo "cast not found (install Foundry or set CAST=/path/to/cast)"; exit 2; }

RPC_URL="${RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
EXPECT_CHAIN_ID="${EXPECT_CHAIN_ID:-4663}"
PERMIT2_ADDRESS="${PERMIT2_ADDRESS:-0x000000000022D473030F116dDEE9F6B43aC78BA3}"
POOL_MANAGER="${POOL_MANAGER:-0x8366a39CC670B4001A1121B8F6A443A643e40951}"
UNIVERSAL_ROUTER="${UNIVERSAL_ROUTER:-0x204FAca1764B154221e35c0d20aBb3c525710498}"
WETH_ADDRESS="${WETH_ADDRESS:-0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73}"

fail=0
ok()   { printf '  [ok]   %s\n' "$*"; }
bad()  { printf '  [FAIL] %s\n' "$*"; fail=1; }
warn() { printf '  [warn] %s\n' "$*"; }

echo "RPC $RPC_URL"

chain="$("$CAST" chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
if [ -z "$chain" ]; then echo "  [FAIL] RPC unreachable: $RPC_URL"; exit 1; fi
if [ "$chain" = "$EXPECT_CHAIN_ID" ]; then ok "eth_chainId = $chain"; else bad "eth_chainId = $chain, expected $EXPECT_CHAIN_ID"; fi

code_size() { local c; c="$("$CAST" code "$1" --rpc-url "$RPC_URL" 2>/dev/null || echo 0x)"; echo $(( (${#c} - 2) / 2 )); }

check_code() { # name address required(1/0)
  local n; n="$(code_size "$2")"
  if [ "$n" -gt 0 ]; then ok "$1 $2 has code ($n bytes)"
  elif [ "$3" = 1 ]; then bad "$1 $2 has NO code"
  else warn "$1 $2 has no code (optional)"; fi
}

check_code "Permit2" "$PERMIT2_ADDRESS" 1
ds="$("$CAST" call "$PERMIT2_ADDRESS" 'DOMAIN_SEPARATOR()(bytes32)' --rpc-url "$RPC_URL" 2>/dev/null || true)"
[ -n "$ds" ] && ok "Permit2 DOMAIN_SEPARATOR() = ${ds:0:18}…" || bad "Permit2 DOMAIN_SEPARATOR() call failed"

check_code "v4 PoolManager" "$POOL_MANAGER" 1
# extsload(bytes32) is a v4 PoolManager-specific view; slot 0 is protocolFeeController-related storage on v4-core
ext="$("$CAST" call "$POOL_MANAGER" 'extsload(bytes32)(bytes32)' 0x0000000000000000000000000000000000000000000000000000000000000000 --rpc-url "$RPC_URL" 2>/dev/null || true)"
[ -n "$ext" ] && ok "PoolManager extsload(0) works" || bad "PoolManager extsload(bytes32) call failed (not a v4 PoolManager?)"

check_code "UniversalRouter (not used by the contracts)" "$UNIVERSAL_ROUTER" 0
# Pons mode: the $COMD token is launched on Pons; its address must exist and be an 18-decimal ERC-20
if [ -n "${COMD_TOKEN:-}" ]; then
  check_code "COMD token (from Pons)" "$COMD_TOKEN" 1
  dec="$("$CAST" call "$COMD_TOKEN" 'decimals()(uint8)' --rpc-url "$RPC_URL" 2>/dev/null || true)"
  [ "$dec" = "18" ] && ok "COMD decimals() = 18" || bad "COMD decimals() = '$dec' (expected 18; the apps assume 18)"
  sup="$("$CAST" call "$COMD_TOKEN" 'totalSupply()(uint256)' --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1}' || true)"
  [ -n "$sup" ] && ok "COMD totalSupply() = $sup" || bad "COMD totalSupply() call failed"
else
  warn "COMD_TOKEN unset: pass the Pons token address to check it"
fi
check_code "WETH" "$WETH_ADDRESS" 0
# optional: the Seaport the Flywheel sweeps Counsel listings from (Deploy.s.sol SEAPORT)
if [ -n "${SEAPORT:-}" ]; then check_code "Seaport" "$SEAPORT" 1; else warn "SEAPORT unset: no SeaportAdapter (floor sweeps need an allowlisted adapter)"; fi

echo
echo "Manual (cannot be checked from RPC):"
echo "  - PoolManager verified source on https://robinhoodchain.blockscout.com is Uniswap's v4-core"
echo "  - ADMIN is a multisig or hardware wallet; SETTLER, KEEPER, REGISTRAR are separate hot wallets"
echo "  - SEAPORT, if set, is the marketplace's verified Seaport deployment"
if [ "$fail" = 0 ]; then echo "ALL REQUIRED CHECKS PASSED"; else echo "SOME CHECKS FAILED — do not deploy"; fi
exit "$fail"
