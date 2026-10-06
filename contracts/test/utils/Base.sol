// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

import {ComdToken} from "../../src/ComdToken.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {RevenueRouter} from "../../src/RevenueRouter.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {ComdTaxHook, IFlywheelTaxSink} from "../../src/ComdTaxHook.sol";
import {BuyWall, IComdTaxHookForWall} from "../../src/BuyWall.sol";
import {StakedComd} from "../../src/StakedComd.sol";
import {RewardDripper} from "../../src/RewardDripper.sol";
import {Bond} from "../../src/Bond.sol";
import {ComdRouter} from "../../src/ComdRouter.sol";
import {MockMarketplace} from "../../src/mocks/MockMarketplace.sol";
import {MerkleHelper} from "./MerkleHelper.sol";

/// @notice Full Company.md system on a real v4 PoolManager: official COMD/ETH pool (tax + capped inventory + buy
///         wall) opened with 100% of supply at a 10 ETH market cap (1e8 COMD per ETH), then 20 ETH of buys.
abstract contract Base is Deployers, MerkleHelper {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    address admin = makeAddr("admin");
    address pol = makeAddr("pol");
    address treasury = makeAddr("treasury");
    address settler = makeAddr("settler");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address market = makeAddr("market");

    ComdToken comd;
    CounselNFT counsel;
    RewardDistributor distributor;
    RevenueRouter revenue;
    Flywheel flywheel;
    ComdTaxHook hook;
    ComdRouter router;
    BuyWall wall;
    StakedComd vault;
    RewardDripper dripper;
    Bond bond;
    MockMarketplace marketplace;
    PoolKey poolKey;

    uint160 constant HOOK_FLAGS = uint160(
        Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    uint256 constant SUPPLY = 1_000_000_000e18;
    uint256 constant MCAP = 10 ether;
    uint256 constant BPS = 10_000;

    function setUpSystem() internal {
        deployFreshManagerAndRouters();
        comd = new ComdToken(pol);
        counsel = new CounselNFT(admin, treasury, "https://api.comd.fun/agents/by-token/");
        distributor = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        revenue = new RevenueRouter(IERC20(address(comd)), address(distributor), treasury, admin);
        vault = new StakedComd(IERC20(address(comd)), admin);
        dripper = new RewardDripper(IERC20(address(comd)), address(vault), admin);
        bond = new Bond(IERC20(address(comd)), treasury, 1e10, admin);
        flywheel = new Flywheel(ERC20Burnable(address(comd)), IERC721(address(counsel)), admin, keeper);
        hook = _deployHook(address(uint160(0x4444) << 144 | HOOK_FLAGS));
        wall = new BuyWall(IComdTaxHookForWall(address(hook)), admin);
        poolKey = hook.poolKey();
        router = new ComdRouter(manager, IERC20(address(comd)), IHooks(address(hook)), 0, 200);
        marketplace = new MockMarketplace();

        vm.startPrank(admin);
        hook.setRouter(address(router));
        hook.setBuyWall(address(wall));
        flywheel.setHook(address(hook));
        flywheel.setRouter(address(router));
        flywheel.setAdapter(address(marketplace), true);
        distributor.grantRole(distributor.SETTLER_ROLE(), settler);
        vm.stopPrank();
    }

    function _deployHook(address at) internal returns (ComdTaxHook h) {
        deployCodeTo(
            "ComdTaxHook.sol:ComdTaxHook",
            abi.encode(
                manager,
                address(comd),
                pol,
                IFlywheelTaxSink(address(flywheel)),
                admin,
                address(bond),
                address(dripper),
                address(distributor)
            ),
            at
        );
        h = ComdTaxHook(payable(at));
    }

    function initAndSeed() internal {
        vm.startPrank(pol);
        comd.approve(address(hook), SUPPLY);
        hook.initializeAndSeed(MCAP, SUPPLY);
        vm.stopPrank();
    }

    /// @dev Seed + 20 ETH of buys so the pool also holds ETH (sells possible, tax taken physically).
    function initSeedAndTrade() internal {
        initAndSeed();
        _buy(market, 20 ether);
        hook.flush(); // the first buy's tax was held as claims (the PoolManager had no ETH yet)
    }

    function _buy(address who, uint256 ethIn) internal returns (uint256 out) {
        vm.deal(who, who.balance + ethIn);
        vm.prank(who);
        out = router.swapExactETHForComd{value: ethIn}(0, who, block.timestamp);
    }

    function _sell(address who, uint256 amountIn) internal returns (uint256 out) {
        if (comd.balanceOf(who) < amountIn) deal(address(comd), who, amountIn);
        vm.startPrank(who);
        comd.approve(address(router), amountIn);
        out = router.swapExactComdForETH(amountIn, 0, who, block.timestamp);
        vm.stopPrank();
    }

    /// @dev Raw swap through the v4 PoolSwapTest router (a third-party router: always taxed).
    function _rawSwap(bool zeroForOne, int256 amountSpecified, uint256 value) internal returns (BalanceDelta) {
        return swapRouter.swap{value: value}(
            poolKey,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _tick() internal view returns (int24 t) {
        (, t,,) = manager.getSlot0(poolKey.toId());
    }

    function _sqrtP() internal view returns (uint160 p) {
        (p,,,) = manager.getSlot0(poolKey.toId());
    }

    /// @dev Tax conservation: everything the hook charged is at the Flywheel (buckets + spent) or pending as claims.
    function _assertTaxConservation() internal view {
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(flywheel.totalTaxIn(), b + s + flywheel.totalBoughtBack() + flywheel.sweepSpent(), "flywheel conservation");
        assertEq(hook.totalTaxed(), flywheel.totalTaxIn() + hook.pendingTax(), "hook conservation");
        assertEq(address(flywheel).balance, b + s, "flywheel ETH == buckets");
        assertEq(address(hook).balance, 0, "hook holds no ETH");
    }

    /// @dev Trim split conservation: burn + 6% + 4.5% + 4.5% == everything split; trimmed COMD = split from trims
    ///      + still-pending claims (+ wall purchases are split too, counted in stats.split).
    function _assertSplitConservation() internal view {
        ComdTaxHook.Stats memory st = hook.stats();
        assertEq(st.burned + st.toBond + st.toStakers + st.toSeats, st.split, "split parts sum");
        assertEq(st.trimmedComd + wall.totalWallBought(), st.split + hook.claimComd(), "trimmed == split + pending");
        assertEq(comd.balanceOf(address(hook)), 0, "hook holds no COMD at rest");
    }

    /// @dev Max cap decay (1,000,000 COMD/day) so trims can be produced in a few simulated days.
    function _fastDecay() internal {
        ComdTaxHook.Params memory p = hook.params();
        p.capDecayPerDay = 1_000_000e18;
        vm.prank(admin);
        hook.setParams(p);
    }

    /// @dev Produce a trim: buy `eth` (opens room), let the cap decay `days_` days, sell everything back.
    ///      With fast decay the trim is ≈ days_ × 1,000,000 COMD (if less than what was bought).
    function _forceTrim(address who, uint256 eth, uint256 days_) internal returns (uint256 got) {
        got = _buy(who, eth);
        vm.warp(block.timestamp + days_ * 1 days);
        vm.roll(block.number + 1);
        _sell(who, got);
    }
}
