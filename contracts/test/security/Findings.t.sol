// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {Base} from "../utils/Base.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {ComdToken} from "../../src/ComdToken.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {MockERC20} from "../mocks/Mocks.sol";
import {ComdTaxHook} from "../../src/ComdTaxHook.sol";
import {TickAlign} from "../../src/libraries/TickAlign.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";
import {StakedComd} from "../../src/StakedComd.sol";
import {RewardDripper} from "../../src/RewardDripper.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// @notice Security review regressions kept for V3 (see contracts/SECURITY_REVIEW.md).

/// C-01 (V2 form) — the V1 hook allowed swaps between `initialize` and `seed` (two POL transactions). In V2 the
/// pool can only be initialized by the hook itself inside `initializeAndSeed`, which seeds in the same transaction.
contract C01_NoPreSeedWindow is Base {
    function setUp() public {
        setUpSystem();
    }

    function test_C01_cannotInitializeOrSwapBeforeSeed() public {
        address attacker = makeAddr("attacker");
        vm.deal(attacker, 1 ether);
        // the attacker cannot create the official pool at a price of their choosing ...
        vm.prank(attacker);
        vm.expectRevert();
        manager.initialize(poolKey, TickMath.getSqrtPriceAtTick(TickMath.MAX_TICK - 1));
        // ... nor swap on it before it exists
        vm.prank(attacker);
        vm.expectRevert();
        router.swapExactETHForComd{value: 1 wei}(0, attacker, block.timestamp);
        // POL opens it atomically at the configured price; the first trade sees exactly that price
        initAndSeed();
        assertEq(_tick(), TickAlign.floor(LaunchMath.openingTick(false, MCAP, SUPPLY), 200));
        uint256 out = _buy(attacker, 1 ether);
        // ≈ 0.95 ETH × 1e8 COMD/ETH, a little less for price impact
        assertGt(out, 85_000_000e18);
        assertLt(out, 95_000_000e18);
    }
}

/// M-03 — RewardDistributor claims are bounded by the root's `total` (also for ETH in V2).
contract M03_DistributorOverClaim is Test, MerkleHelper {
    ComdToken comd;
    CounselNFT counsel;
    RewardDistributor dist;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        comd = new ComdToken(address(this));
        counsel = new CounselNFT(admin, admin, "u/");
        dist = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        bytes32 role = dist.SETTLER_ROLE();
        vm.startPrank(admin);
        dist.grantRole(role, settler);
        counsel.reserveMint(alice, 1); // id 1
        counsel.reserveMint(bob, 1); // id 2
        vm.stopPrank();
        comd.transfer(address(dist), 1_000e18);
        vm.deal(address(dist), 1 ether);
    }

    function _overClaim(address asset, uint256 amt) internal {
        bytes32[] memory l1 = new bytes32[](2);
        l1[0] = _seatLeaf(1, 2, amt);
        l1[1] = _seatLeaf(1, 99, 0);
        vm.prank(settler);
        dist.postRoot(1, asset, _root(l1), amt);
        bytes32[] memory l2 = new bytes32[](2);
        l2[0] = _seatLeaf(2, 1, amt);
        l2[1] = _seatLeaf(2, 99, 0);
        vm.prank(settler);
        dist.postRoot(2, asset, _root(l2), 0); // total 0, but a leaf for `amt`
        vm.expectRevert(RewardDistributor.ExceedsTotal.selector);
        dist.claimToken(asset, 2, 1, amt, _proof(l2, 0));
        dist.claimToken(asset, 1, 2, amt, _proof(l1, 0));
    }

    function test_M03_claimCannotExceedRootTotal() public {
        _overClaim(address(comd), 1_000e18);
        assertEq(comd.balanceOf(bob), 1_000e18);
    }

    function test_M03_otherTokenClaimCannotExceedRootTotal() public {
        MockERC20 u = new MockERC20("Other", "OTH");
        u.mint(address(dist), 1_000e6);
        _overClaim(address(u), 1_000e6);
        assertEq(u.balanceOf(bob), 1_000e6);
    }

    function test_M03_ethClaimCannotExceedRootTotal() public {
        _overClaim(address(0), 1 ether);
        assertEq(bob.balance, 1 ether);
    }
}

/// L-02 — opening tick for very large supply/marketCap ratios (now in LaunchMath, shared by the factory and the
/// tax hook).
contract L02_OpeningTickOverflow is Test {
    function test_L02_openingTickLargeRatio() public pure {
        assertApproxEqAbs(int256(LaunchMath.openingTick(false, 1_000e6, 1_000_000_000_000e18)), int256(483_567), 1);
        assertApproxEqAbs(int256(LaunchMath.openingTick(false, 10 ether, 1_000_000_000e18)), int256(184_216), 1);
        assertApproxEqAbs(int256(LaunchMath.openingTick(true, 1_000e6, 1_000_000_000_000e18)), int256(-483_568), 1);
    }
}

/// H-01 — the V1 buy-wall floor moved toward the price IMMEDIATELY once the block-lagged reference caught up: holding a
/// pump for a few blocks, then triggering a rebalance, posted the protocol's bid far above the pre-pump market and the
/// attacker sold into it. In V3 the wall lives in BuyWall; the floor moves toward the price by at most one day's
/// allowance (400 ticks) per update.
contract H01_WallFloorManipulation is Base {
    address att = makeAddr("attacker");

    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
        vm.deal(address(wall), 20 ether); // wall budget (normally trim proceeds)
        vm.roll(block.number + 1);
        wall.rebalance();
    }

    function _sellAll() internal returns (uint256 ethOut) {
        uint256 bal = comd.balanceOf(att);
        vm.startPrank(att);
        comd.approve(address(router), bal);
        ethOut = router.swapExactComdForETH(bal, 0, att, block.timestamp);
        vm.stopPrank();
    }

    function test_H01_pumpedReferenceCannotDragWallAboveMarket() public {
        deal(address(comd), att, 300_000_000e18);
        vm.deal(att, 1_000 ether);
        uint256 snap = vm.snapshotState();
        uint256 baseline = _sellAll();
        vm.revertToState(snap);

        int24 wall0 = wall.wallLower();
        vm.prank(att);
        router.swapExactETHForComd{value: 10 ether}(0, att, block.timestamp);
        for (uint256 i; i < 15; ++i) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            vm.prank(att);
            router.swapExactETHForComd{value: 1e12}(0, att, block.timestamp);
        }
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
        vm.deal(address(wall), address(wall).balance + 0.2 ether); // trigger a rebalance
        vm.prank(att);
        wall.rebalance();
        assertGe(wall.wallLower(), wall0 - 400, "wall dragged toward the pumped price");
        uint256 ethBack = _sellAll();
        // the attacker paid 10 ETH (+ tax) for the pump; selling everything must not beat the honest baseline by it
        assertLt(int256(ethBack) - 10 ether, int256(baseline), "manipulation profitable");
    }

    function test_H01_floorStillFollowsAGenuineRally() public {
        int24 f0 = wall.floorTick();
        _buy(alice, 10 ether); // real, sustained rally
        for (uint256 d; d < 3; ++d) {
            vm.warp(block.timestamp + 1 days);
            vm.roll(block.number + 7_200);
            hook.observe();
            vm.deal(address(wall), address(wall).balance + 0.2 ether);
            wall.rebalance();
        }
        assertLe(wall.floorTick(), f0 - 1_100, "~400 ticks/day toward the price");
        assertGe(wall.floorTick(), f0 - 1_200);
        assertGt(wall.wallLower(), _tick(), "wall still below the price");
    }
}

/// M-02 — StakedComd's one-block hold was set on the RECEIVER of any deposit, so anyone could deposit 1 wei for a
/// victim each block and keep the victim's whole balance frozen (no withdraw / redeem / transfer).
contract M02_StakeHoldGriefing is Test {
    ComdToken comd;
    StakedComd vault;
    address alice = makeAddr("alice");
    address griefer = makeAddr("griefer");

    function setUp() public {
        comd = new ComdToken(address(this));
        vault = new StakedComd(IERC20(address(comd)), address(this));
        comd.transfer(alice, 1_000e18);
        comd.transfer(griefer, 1e18);
        vm.prank(alice);
        comd.approve(address(vault), type(uint256).max);
        vm.prank(griefer);
        comd.approve(address(vault), type(uint256).max);
    }

    function test_M02_depositForVictimDoesNotFreezeTheirStake() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000e18, alice);
        vm.roll(block.number + 5);
        // griefer front-runs alice's exit with a 1-wei deposit for her
        vm.prank(griefer);
        uint256 gift = vault.deposit(1, alice);
        // alice can still exit everything she owned before this block
        assertEq(vault.maxRedeem(alice), shares);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertEq(comd.balanceOf(alice), 1_000e18);
        // the gifted shares themselves are held for this block (anti flash-stake)
        assertEq(vault.maxRedeem(alice), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, alice, gift, 0));
        vault.redeem(gift, alice, alice);
        vm.prank(alice);
        vm.expectRevert(StakedComd.SameBlockHold.selector);
        vault.transfer(griefer, gift);
        vm.roll(block.number + 1);
        vm.prank(alice);
        vault.redeem(gift, alice, alice);
    }

    function test_M02_ownDepositStillHeldSameBlock() public {
        vm.prank(alice);
        uint256 s = vault.deposit(100e18, alice);
        assertEq(vault.maxRedeem(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, alice, s, 0));
        vault.redeem(s, alice, alice);
        vm.prank(alice);
        vm.expectRevert(StakedComd.SameBlockHold.selector);
        vault.transfer(griefer, 1);
    }
}

/// L-01 — the dripper streamed into an EMPTY vault: with OZ virtual shares those assets belong to the virtual
/// shares forever (no staker can ever withdraw them). Rewards now wait in the dripper until someone stakes.
contract L01_DripIntoEmptyVault is Test {
    ComdToken comd;
    StakedComd vault;
    RewardDripper dripper;
    address alice = makeAddr("alice");

    function setUp() public {
        comd = new ComdToken(address(this));
        vault = new StakedComd(IERC20(address(comd)), address(this));
        dripper = new RewardDripper(IERC20(address(comd)), address(vault), address(this));
        comd.transfer(address(dripper), 100_000e18);
        comd.transfer(alice, 1_000e18);
        vm.prank(alice);
        comd.approve(address(vault), type(uint256).max);
    }

    function test_L01_noDripWhileVaultEmpty() public {
        vm.warp(block.timestamp + 1 hours);
        assertEq(dripper.pending(), 0, "pending while vault empty");
        dripper.drip();
        assertEq(comd.balanceOf(address(vault)), 0, "rewards stranded in empty vault");
        // once someone stakes, the stream resumes and the staker owns the rewards
        vm.prank(alice);
        vault.deposit(1_000e18, alice);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1 hours);
        uint256 p = dripper.drip();
        assertGt(p, 0);
        assertApproxEqAbs(vault.maxWithdraw(alice), 1_000e18 + p, 1e9);
    }
}

/// I-01 (verified, no change) — classic ERC-4626 first-depositor donation attack against sCOMD: with the
/// decimals offset of 6 the victim keeps (almost) all of their deposit and the attacker burns their donation.
contract I01_VaultInflationResistance is Test {
    ComdToken comd;
    StakedComd vault;
    address attacker = makeAddr("attacker");
    address victim = makeAddr("victim");

    function setUp() public {
        comd = new ComdToken(address(this));
        vault = new StakedComd(IERC20(address(comd)), address(this));
        comd.transfer(attacker, 1_000_001e18);
        comd.transfer(victim, 1_000e18);
        vm.prank(attacker);
        comd.approve(address(vault), type(uint256).max);
        vm.prank(victim);
        comd.approve(address(vault), type(uint256).max);
    }

    function test_I01_donationAttackUnprofitable() public {
        vm.prank(attacker);
        vault.deposit(1, attacker);
        vm.prank(attacker);
        comd.transfer(address(vault), 1_000_000e18); // donation
        vm.prank(victim);
        uint256 s = vault.deposit(1_000e18, victim);
        assertGt(s, 0, "victim minted zero shares");
        vm.roll(block.number + 1);
        vm.prank(victim);
        uint256 back = vault.redeem(s, victim, victim);
        assertGe(back, 999e18, "victim lost > 0.1%");
        uint256 as_ = vault.balanceOf(attacker);
        vm.prank(attacker);
        uint256 got = vault.redeem(as_, attacker, attacker);
        assertLt(got, 1_000_000e18, "attacker profited from the donation");
    }
}
