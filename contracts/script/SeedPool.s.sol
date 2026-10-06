// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ComdTaxHook} from "../src/ComdTaxHook.sol";

/// @title SeedPool — run by the POL wallet: open the official COMD/ETH pool with 100% of the COMD supply
/// @notice UNAUDITED — experimental.
/// @dev Two transactions in one broadcast: `approve`, then `ComdTaxHook.initializeAndSeed`, which initializes the
///      pool AND deposits the single-sided position in the SAME transaction (no pre-seed swap window, C-01).
///   Env-only (CI friendly); prints a JSON summary between SEED_JSON_BEGIN / SEED_JSON_END.
///   POL_PRIVATE_KEY       (required)
///   HOOK                  (required) comdTaxHook from deployments/<chainId>.json
///   INITIAL_MARKET_CAP_WEI  ETH value of the whole 1B supply at the opening price (default 10 ether)
///   SEED_COMD             default: the POL wallet's whole COMD balance (= 100% of supply)
contract SeedPool is Script {
    function run() external {
        uint256 pk = vm.envUint("POL_PRIVATE_KEY");
        address pol = vm.addr(pk);
        ComdTaxHook hook = ComdTaxHook(payable(vm.envAddress("HOOK")));
        IERC20 comd = IERC20(address(hook.comd()));
        uint256 mcap = vm.envOr("INITIAL_MARKET_CAP_WEI", uint256(10 ether));
        uint256 amount = vm.envOr("SEED_COMD", comd.balanceOf(pol));
        require(hook.pol() == pol, "not the POL wallet");

        vm.startBroadcast(pk);
        seed(hook, mcap, amount);
        vm.stopBroadcast();
        (, int24 tick) = hook.slot0();
        console2.log("opening tick", tick);
        console2.log("position liquidity", hook.positionLiquidity());
        console2.log("COMD left in POL wallet (rounding dust)", comd.balanceOf(pol));
        string memory k = "seed";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "comdTaxHook", address(hook));
        vm.serializeInt(k, "openingTick", int256(tick));
        vm.serializeUint(k, "initialMarketCapWei", mcap);
        string memory json = vm.serializeUint(k, "seededComd", amount);
        console2.log("SEED_JSON_BEGIN");
        console2.log(json);
        console2.log("SEED_JSON_END");
    }

    /// @notice The two calls the POL wallet makes (also used by tests).
    function seed(ComdTaxHook hook, uint256 initialMarketCapWei, uint256 amount) public {
        hook.comd().approve(address(hook), amount);
        hook.initializeAndSeed(initialMarketCapWei, amount);
    }
}
