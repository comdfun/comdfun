// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {MockComd} from "../../src/mocks/MockComd.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {RevenueRouter} from "../../src/RevenueRouter.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {Incorporations} from "../../src/Incorporations.sol";
import {IBuybackSwapper} from "../../src/interfaces/IBuybackSwapper.sol";
import {UniswapV4PoolSwapper} from "../../src/swap/UniswapV4PoolSwapper.sol";
import {MockMarketplace} from "../../src/mocks/MockMarketplace.sol";
import {MockSwapper} from "../mocks/Mocks.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @notice Company.md system in Pons mode: COMD is an external plain ERC-20 (MockComd, 1B to this test contract),
///         the Flywheel receives ETH from anyone and swaps through a pluggable IBuybackSwapper. By default the
///         swapper is a fixed-rate MockSwapper (1 ETH = 1e8 COMD); `setUpV4Pool()` adds a real, hookless v4
///         ETH/COMD pool on a local PoolManager behind a UniswapV4PoolSwapper.
abstract contract Base is Deployers, MerkleHelper {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address settler = makeAddr("settler");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address market = makeAddr("market"); // stands in for Pons's payout: sends ETH to the Flywheel

    MockComd comd;
    CounselNFT counsel;
    RewardDistributor distributor;
    RevenueRouter revenue;
    Flywheel flywheel;
    MockSwapper swapper;
    Incorporations inc;
    MockMarketplace marketplace;

    // real v4 pool (setUpV4Pool)
    UniswapV4PoolSwapper v4swapper;
    PoolKey poolKey;

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant RATE = 1e8; // COMD per ETH (10 ETH market cap for 1B COMD)
    uint256 constant BPS = 10_000;
    uint24 constant POOL_FEE = 3_000;
    int24 constant POOL_SPACING = 60;
    int24 constant POOL_TICK = 184_200; // ≈ 1e8 COMD per ETH

    function setUpSystem() internal {
        deployFreshManagerAndRouters();
        comd = new MockComd();
        counsel = new CounselNFT(admin, treasury, "https://api.comd.fun/agents/by-token/");
        distributor = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        revenue = new RevenueRouter(IERC20(address(comd)), address(distributor), treasury, admin);
        flywheel = new Flywheel(IERC20(address(comd)), IERC721(address(counsel)), admin, keeper);
        swapper = new MockSwapper(IERC20(address(comd)), RATE * 1e18);
        comd.transfer(address(swapper), 300_000_000e18);
        vm.deal(address(swapper), 100 ether);
        marketplace = new MockMarketplace();
        inc = new Incorporations(
            IERC20(address(comd)), address(distributor), IBuybackSwapper(address(swapper)), admin
        );

        vm.startPrank(admin);
        flywheel.setSwapper(address(swapper));
        flywheel.setAdapter(address(marketplace), true);
        distributor.grantRole(distributor.SETTLER_ROLE(), settler);
        vm.stopPrank();
    }

    /// @dev Hookless ETH/COMD pool at ≈ 1e8 COMD per ETH with full-range liquidity (≈ 5 ETH + 5e8 COMD), and a
    ///      UniswapV4PoolSwapper (owner admin) configured for it. Pons's real pool has Pons's hook instead.
    function setUpV4Pool() internal {
        poolKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(comd)), POOL_FEE, POOL_SPACING, IHooks(address(0)));
        manager.initialize(poolKey, TickMath.getSqrtPriceAtTick(POOL_TICK));
        comd.approve(address(modifyLiquidityRouter), type(uint256).max);
        vm.deal(address(this), address(this).balance + 10 ether);
        modifyLiquidityRouter.modifyLiquidity{value: 6 ether}(
            poolKey,
            ModifyLiquidityParams({tickLower: -887_220, tickUpper: 887_220, liquidityDelta: 5e22, salt: 0}),
            ""
        );
        v4swapper = new UniswapV4PoolSwapper(manager, IERC20(address(comd)), admin);
        vm.prank(admin);
        v4swapper.setPoolKey(POOL_FEE, POOL_SPACING, IHooks(address(0)));
    }

    /// @dev Switch the Flywheel and Incorporations to the real v4 pool swapper.
    function useV4Swapper() internal {
        vm.startPrank(admin);
        flywheel.setSwapper(address(v4swapper));
        inc.setSwapper(address(v4swapper));
        vm.stopPrank();
    }

    /// @dev Pons pays the creator wallet in ETH; the wallet (or Pons directly) forwards it to the Flywheel.
    function _tax(uint256 eth) internal {
        vm.deal(market, market.balance + eth);
        vm.prank(market);
        (bool ok,) = address(flywheel).call{value: eth}("");
        require(ok, "tax in");
    }

    function _tick() internal view returns (int24 t) {
        (, t,,) = manager.getSlot0(poolKey.toId());
    }

    /// @dev Tax conservation: everything received is at the Flywheel (buckets) or was spent (buyback / sweeps).
    function _assertTaxConservation() internal view {
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(flywheel.totalTaxIn(), b + s + flywheel.totalBoughtBack() + flywheel.sweepSpent(), "flywheel conservation");
        assertEq(address(flywheel).balance, b + s, "flywheel ETH == buckets");
        assertEq(comd.balanceOf(address(flywheel)), 0, "flywheel holds no COMD (all buybacks burned)");
        assertEq(comd.balanceOf(DEAD), flywheel.totalBurned() + inc.totalBurned(), "dead address == burned");
    }
}
