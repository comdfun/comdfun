// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Base} from "./utils/Base.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {RevenueRouter} from "../src/RevenueRouter.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {Incorporations} from "../src/Incorporations.sol";
import {MockERC20, OtherNFT} from "./mocks/Mocks.sol";

/// @notice V7 safety nets B/C on the value-holding contracts: owner-only pause + recovery, hot-key rotation.
///         Every test checks: the owner can, others cannot, paused paths revert, unpause restores.
contract FlywheelSafetyTest is Base {
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        _tax(1 ether);
        vm.prank(admin);
        counsel.reserveMint(seller, 3);
        vm.prank(seller);
        counsel.setApprovalForAll(address(marketplace), true);
    }

    function test_pauseStopsBuybackAndSweepNotIntake() public {
        vm.prank(alice);
        vm.expectRevert();
        flywheel.pause();
        vm.prank(admin);
        flywheel.pause();
        assertTrue(flywheel.paused());
        vm.prank(keeper);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        flywheel.buyback(0);
        vm.prank(seller);
        marketplace.list(address(counsel), 1, 0.1 ether);
        vm.prank(keeper);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        flywheel.sweep(address(marketplace), "", 1, 0.2 ether);
        // Pons payouts must never bounce
        _tax(0.5 ether);
        assertEq(flywheel.totalTaxIn(), 1.5 ether);
        vm.prank(alice);
        vm.expectRevert();
        flywheel.unpause();
        vm.prank(admin);
        flywheel.unpause();
        vm.prank(keeper);
        assertGt(flywheel.buyback(0), 0);
        vm.prank(keeper);
        flywheel.sweep(address(marketplace), "", 1, 0.2 ether);
        assertEq(counsel.ownerOf(1), address(flywheel));
        _assertTaxConservation();
    }

    function test_rescueEthOnlyPausedOnlyOwnerPerBucket() public {
        vm.prank(admin);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        flywheel.rescueETH(treasury, 0.1 ether, 0);
        vm.prank(admin);
        flywheel.pause();
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.rescueETH(keeper, 0.1 ether, 0);
        vm.startPrank(admin);
        vm.expectRevert(Flywheel.InsufficientBucket.selector);
        flywheel.rescueETH(treasury, 0.6 ether, 0);
        vm.expectRevert(Flywheel.InsufficientBucket.selector);
        flywheel.rescueETH(treasury, 0, 0.6 ether);
        vm.expectRevert(Flywheel.Empty.selector);
        flywheel.rescueETH(treasury, 0, 0);
        vm.expectRevert(Flywheel.ZeroAddress.selector);
        flywheel.rescueETH(address(0), 0.1 ether, 0);
        vm.expectEmit(true, false, false, true, address(flywheel));
        emit Flywheel.EthRescued(treasury, 0.2 ether, 0.5 ether);
        flywheel.rescueETH(treasury, 0.2 ether, 0.5 ether);
        vm.stopPrank();
        assertEq(treasury.balance, 0.7 ether);
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 0.3 ether);
        assertEq(s, 0);
        assertEq(flywheel.totalRescued(), 0.7 ether);
        _assertTaxConservation();
        // the rest can still be bought back after unpausing
        vm.prank(admin);
        flywheel.unpause();
        vm.prank(keeper);
        assertEq(flywheel.buyback(0), 0.3 ether * 1e8);
        _assertTaxConservation();
    }

    function test_rescueErc20AndErc721() public {
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(flywheel), 9e18);
        comd.transfer(address(flywheel), 5e18); // someone sends COMD by mistake
        OtherNFT o = new OtherNFT();
        o.mint(address(this), 1);
        o.transferFrom(address(this), address(flywheel), 1); // unsafe push bypasses onERC721Received
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.rescueERC20(IERC20(address(t)), keeper, 9e18);
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.rescueERC721(IERC721(address(o)), 1, keeper);
        vm.startPrank(admin);
        flywheel.rescueERC20(IERC20(address(t)), treasury, 9e18);
        flywheel.rescueERC20(IERC20(address(comd)), treasury, 5e18);
        flywheel.rescueERC721(IERC721(address(o)), 1, treasury);
        vm.stopPrank();
        assertEq(t.balanceOf(treasury), 9e18);
        assertEq(comd.balanceOf(treasury), 5e18);
        assertEq(o.ownerOf(1), treasury);
        assertEq(comd.balanceOf(address(flywheel)), 0);
    }

    /// Swept Counsel NFTs: the owner can move them any time (awardSwept), also while paused, and rescueERC721 on a
    /// swept id keeps the swept list consistent.
    function test_sweptCounselAlwaysMovableByOwner() public {
        vm.startPrank(seller);
        marketplace.list(address(counsel), 1, 0.05 ether);
        marketplace.list(address(counsel), 2, 0.05 ether);
        vm.stopPrank();
        vm.startPrank(keeper);
        flywheel.sweep(address(marketplace), "", 1, 0.1 ether);
        flywheel.sweep(address(marketplace), "", 2, 0.1 ether);
        vm.stopPrank();
        vm.prank(admin);
        flywheel.pause();
        vm.prank(admin);
        flywheel.awardSwept(1, alice); // works while paused
        assertEq(counsel.ownerOf(1), alice);
        vm.expectEmit(true, true, true, true, address(flywheel));
        emit Flywheel.NftRescued(address(counsel), 2, bob);
        vm.prank(admin);
        flywheel.rescueERC721(IERC721(address(counsel)), 2, bob);
        assertEq(counsel.ownerOf(2), bob);
        assertEq(flywheel.sweptTokenIds().length, 0, "swept list cleaned");
        assertEq(flywheel.totalSwept(), 2, "cumulative count unchanged");
        vm.prank(admin);
        vm.expectRevert(Flywheel.NotSwept.selector);
        flywheel.awardSwept(2, alice);
        // and the id can be swept again later
        vm.prank(admin);
        flywheel.unpause();
        vm.startPrank(bob);
        counsel.setApprovalForAll(address(marketplace), true);
        marketplace.list(address(counsel), 2, 0.05 ether);
        vm.stopPrank();
        vm.prank(keeper);
        flywheel.sweep(address(marketplace), "", 2, 0.1 ether);
        assertEq(flywheel.sweptTokenIds().length, 1);
    }

    function test_keeperRotation() public {
        address newKeeper = makeAddr("keeper2");
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.setKeeper(keeper);
        vm.prank(admin);
        flywheel.setKeeper(newKeeper);
        vm.prank(keeper);
        vm.expectRevert(Flywheel.NotKeeper.selector);
        flywheel.buyback(0);
        vm.prank(newKeeper);
        assertGt(flywheel.buyback(0), 0);
    }

    function test_constructorEmitsAndSetsEverything() public view {
        assertEq(flywheel.owner(), admin);
        assertEq(flywheel.pendingOwner(), address(0));
        assertEq(flywheel.keeper(), keeper);
        assertEq(address(flywheel.swapper()), address(swapper));
        assertEq(flywheel.maxSweepPrice(), 0.5 ether);
        assertTrue(flywheel.adapterAllowed(address(marketplace)));
        assertFalse(flywheel.paused());
    }
}

contract RevenueRouterSafetyTest is Base {
    function setUp() public {
        setUpSystem();
        comd.transfer(address(revenue), 100e18);
    }

    function test_pauseDistributeAndRescue() public {
        vm.prank(alice);
        vm.expectRevert();
        revenue.pause();
        // COMD cannot be pulled out while live: distribute() is the only exit
        vm.prank(admin);
        vm.expectRevert(RevenueRouter.PauseFirst.selector);
        revenue.rescueERC20(IERC20(address(comd)), treasury, 100e18);
        // other tokens any time
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(revenue), 3e18);
        vm.prank(admin);
        revenue.rescueERC20(IERC20(address(t)), treasury, 3e18);
        assertEq(t.balanceOf(treasury), 3e18);

        vm.prank(admin);
        revenue.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        revenue.distribute();
        vm.prank(alice);
        vm.expectRevert();
        revenue.rescueERC20(IERC20(address(comd)), alice, 100e18);
        vm.expectEmit(true, true, false, true, address(revenue));
        emit RevenueRouter.Rescued(address(comd), treasury, 40e18);
        vm.prank(admin);
        revenue.rescueERC20(IERC20(address(comd)), treasury, 40e18);
        assertEq(comd.balanceOf(treasury), 40e18);
        vm.prank(admin);
        revenue.unpause();
        (uint256 r, uint256 t2) = revenue.distribute();
        assertEq(r, 48e18);
        assertEq(t2, 12e18);
        assertEq(comd.balanceOf(address(revenue)), 0);
    }

    /// Permit2 settlement is a plain ERC-20 transfer to the router: it keeps working while paused.
    function test_receivingRevenueNeverBlocked() public {
        vm.prank(admin);
        revenue.pause();
        comd.transfer(address(revenue), 1e18);
        assertEq(comd.balanceOf(address(revenue)), 101e18);
    }
}

contract RewardDistributorSafetyTest is Base {
    bytes32[] leaves;

    function setUp() public {
        setUpSystem();
        vm.startPrank(admin);
        counsel.reserveMint(alice, 1); // id 1
        counsel.reserveMint(bob, 1); // id 2
        vm.stopPrank();
        comd.transfer(address(distributor), 1_000e18);
        vm.deal(address(distributor), 2 ether);
        leaves.push(_seatLeaf(1, 1, 300e18));
        leaves.push(_seatLeaf(1, 2, 200e18));
    }

    function test_pauseClaimsAndPosting() public {
        vm.prank(settler);
        distributor.postRoot(1, address(comd), _root(leaves), 500e18);
        vm.prank(settler);
        vm.expectRevert();
        distributor.pause();
        vm.prank(admin);
        distributor.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        distributor.claim(1, 1, 300e18, _proof(leaves, 0));
        vm.prank(settler);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        distributor.postRoot(2, address(comd), bytes32(uint256(1)), 1);
        // funding still arrives
        comd.transfer(address(distributor), 1e18);
        vm.prank(admin);
        distributor.unpause();
        distributor.claim(1, 1, 300e18, _proof(leaves, 0));
        assertEq(comd.balanceOf(alice), 300e18);
    }

    /// A wrong root (off-chain bug or leaked settler key) is cancelled at once; already-paid claims stay paid; the
    /// remainder is free again; the fix is re-posted under a new epoch id.
    function test_revokeBadRoot() public {
        vm.prank(settler);
        distributor.postRoot(1, address(comd), _root(leaves), 500e18);
        distributor.claim(1, 1, 300e18, _proof(leaves, 0));
        assertEq(distributor.outstanding(address(comd)), 200e18);
        vm.prank(settler);
        vm.expectRevert();
        distributor.revokeRoot(1, address(comd));
        vm.expectEmit(true, true, false, true, address(distributor));
        emit RewardDistributor.RootRevoked(1, address(comd), 200e18);
        vm.prank(admin);
        distributor.revokeRoot(1, address(comd));
        assertEq(distributor.outstanding(address(comd)), 0);
        assertEq(distributor.unallocated(address(comd)), 700e18);
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        distributor.claim(1, 2, 200e18, _proof(leaves, 1));
        vm.prank(admin);
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        distributor.revokeRoot(1, address(comd));
        // the same epoch id cannot be reused (RootExists): the corrected tree goes under a new id
        vm.prank(settler);
        vm.expectRevert(RewardDistributor.RootExists.selector);
        distributor.postRoot(1, address(comd), _root(leaves), 200e18);
        bytes32[] memory l2 = new bytes32[](2);
        l2[0] = _seatLeaf(2, 2, 200e18);
        l2[1] = _seatLeaf(2, 99, 0);
        vm.prank(settler);
        distributor.postRoot(2, address(comd), _root(l2), 200e18);
        distributor.claim(2, 2, 200e18, _proof(l2, 0));
        assertEq(comd.balanceOf(bob), 200e18);
    }

    function test_rescueOnlyUnallocated() public {
        vm.prank(settler);
        distributor.postRoot(1, address(comd), _root(leaves), 500e18);
        vm.deal(address(this), 1 ether);
        bytes32[] memory le = new bytes32[](2);
        le[0] = _seatLeaf(5, 1, 1 ether);
        le[1] = _seatLeaf(5, 99, 0);
        vm.prank(settler);
        distributor.postRoot(5, address(0), _root(le), 1 ether);
        // unallocated: 500 COMD, 1 ETH
        vm.prank(settler);
        vm.expectRevert();
        distributor.rescueERC20(IERC20(address(comd)), settler, 1);
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 500e18, 500e18 + 1));
        distributor.rescueERC20(IERC20(address(comd)), treasury, 500e18 + 1);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 1 ether, 1 ether + 1));
        distributor.rescueETH(treasury, 1 ether + 1);
        distributor.rescueERC20(IERC20(address(comd)), treasury, 500e18);
        distributor.rescueETH(treasury, 1 ether);
        vm.stopPrank();
        assertEq(comd.balanceOf(treasury), 500e18);
        assertEq(treasury.balance, 1 ether);
        // committed roots still pay in full
        distributor.claim(1, 1, 300e18, _proof(leaves, 0));
        distributor.claim(1, 2, 200e18, _proof(leaves, 1));
        distributor.claimToken(address(0), 5, 1, 1 ether, _proof(le, 0));
        assertEq(comd.balanceOf(address(distributor)), 0);
        assertEq(address(distributor).balance, 0);
        // to reach committed funds the admin must revoke first (evented), then rescue
        vm.deal(address(distributor), 1 ether);
        bytes32[] memory l3 = new bytes32[](2);
        l3[0] = _seatLeaf(6, 2, 1 ether);
        l3[1] = _seatLeaf(6, 99, 0);
        vm.prank(settler);
        distributor.postRoot(6, address(0), _root(l3), 1 ether);
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 0, 1 ether));
        distributor.rescueETH(treasury, 1 ether);
        distributor.revokeRoot(6, address(0));
        distributor.rescueETH(treasury, 1 ether);
        vm.stopPrank();
        assertEq(treasury.balance, 2 ether);
    }

    function test_settlerRotation() public {
        address settler2 = makeAddr("settler2");
        bytes32 role = distributor.SETTLER_ROLE();
        vm.prank(settler);
        vm.expectRevert();
        distributor.grantRole(role, settler2);
        vm.startPrank(admin);
        distributor.revokeRole(role, settler);
        distributor.grantRole(role, settler2);
        vm.stopPrank();
        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, settler, role)
        );
        distributor.postRoot(1, address(comd), _root(leaves), 500e18);
        vm.prank(settler2);
        distributor.postRoot(1, address(comd), _root(leaves), 500e18);
        assertEq(distributor.outstanding(address(comd)), 500e18);
    }
}

contract IncorporationsSafetyTest is Base {
    address launcher = makeAddr("launcher");
    address coin;

    function setUp() public {
        setUpSystem();
        vm.prank(launcher);
        coin = inc.create("Acme", "ACME", "");
        comd.transfer(alice, 1_000_000e18);
        vm.startPrank(alice);
        comd.approve(address(inc), type(uint256).max);
        IERC20(coin).approve(address(inc), type(uint256).max);
        inc.buyWithComd(coin, 10_000e18, 0);
        vm.stopPrank();
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        inc.buyWithETH{value: 1 ether}(coin, 0); // launcher earns 0.005 ETH
    }

    function test_pauseFreezesTradingNotLauncherClaims() public {
        vm.prank(alice);
        vm.expectRevert();
        inc.pause();
        vm.prank(admin);
        inc.pause();
        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        inc.create("B", "B", "");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        inc.buyWithComd(coin, 1e18, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        inc.sellForComd(coin, 1e18, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        inc.buyWithETH{value: 0}(coin, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        inc.sellForETH(coin, 1e18, 0);
        vm.stopPrank();
        assertEq(inc.totalLauncherEthOwed(), 0.005 ether);
        vm.prank(launcher);
        assertEq(inc.claimLauncherEth(), 0.005 ether);
        assertEq(inc.totalLauncherEthOwed(), 0);
        vm.prank(admin);
        inc.unpause();
        vm.prank(alice);
        assertGt(inc.buyWithComd(coin, 1e18, 0), 0);
    }

    function test_rescueOnlySurplus() public {
        uint256 backing = inc.totalBacking();
        assertEq(comd.balanceOf(address(inc)), backing, "no surplus yet");
        assertEq(inc.comdSurplus(), 0);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.ExceedsSurplus.selector, 0, 1));
        inc.rescueERC20(IERC20(address(comd)), treasury, 1);
        comd.transfer(address(inc), 7e18); // stray COMD
        assertEq(inc.comdSurplus(), 7e18);
        vm.prank(alice);
        vm.expectRevert();
        inc.rescueERC20(IERC20(address(comd)), alice, 7e18);
        vm.prank(admin);
        inc.rescueERC20(IERC20(address(comd)), treasury, 7e18);
        assertEq(comd.balanceOf(treasury), 7e18);
        assertEq(comd.balanceOf(address(inc)), backing);
        // the company coin itself: only above its curve reserve
        uint256 reserve = inc.coinInfo(coin).coinReserve;
        assertEq(IERC20(coin).balanceOf(address(inc)), reserve);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.ExceedsSurplus.selector, 0, 1));
        inc.rescueERC20(IERC20(coin), treasury, 1);
        vm.prank(alice);
        IERC20(coin).transfer(address(inc), 100e18); // stray coins
        vm.prank(admin);
        inc.rescueERC20(IERC20(coin), treasury, 100e18);
        assertEq(IERC20(coin).balanceOf(address(inc)), reserve);
        // any other token fully
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(inc), 5e18);
        vm.prank(admin);
        inc.rescueERC20(IERC20(address(t)), treasury, 5e18);
        assertEq(t.balanceOf(treasury), 5e18);
        // ETH: only above what launchers are owed
        assertEq(address(inc).balance, 0.005 ether);
        assertEq(inc.ethSurplus(), 0);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.ExceedsSurplus.selector, 0, 1));
        inc.rescueETH(treasury, 1);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(inc).call{value: 0.3 ether}("");
        assertTrue(ok);
        vm.prank(admin);
        inc.rescueETH(treasury, 0.3 ether);
        assertEq(treasury.balance, 0.3 ether);
        vm.prank(launcher);
        assertEq(inc.claimLauncherEth(), 0.005 ether);
    }

    function test_emergencyWithdrawIsPausedTimeLockedAndBlocksUnpauseUntilSolvent() public {
        vm.prank(admin);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        inc.scheduleEmergencyWithdraw();
        vm.prank(admin);
        inc.pause();
        vm.prank(alice);
        vm.expectRevert();
        inc.scheduleEmergencyWithdraw();
        vm.prank(admin);
        vm.expectRevert(Incorporations.NotScheduled.selector);
        inc.emergencyWithdraw(treasury);
        vm.expectEmit(false, false, false, true, address(inc));
        emit Incorporations.EmergencyWithdrawScheduled(block.timestamp + 48 hours);
        vm.prank(admin);
        inc.scheduleEmergencyWithdraw();
        uint256 at = inc.emergencyWithdrawAt();
        assertEq(at, block.timestamp + 48 hours);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.TooEarly.selector, at));
        inc.emergencyWithdraw(treasury);
        vm.warp(at - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.TooEarly.selector, at));
        inc.emergencyWithdraw(treasury);
        // cancel resets
        vm.prank(admin);
        inc.cancelEmergencyWithdraw();
        assertEq(inc.emergencyWithdrawAt(), 0);
        vm.prank(admin);
        inc.scheduleEmergencyWithdraw();
        vm.warp(block.timestamp + 48 hours);
        uint256 cb = comd.balanceOf(address(inc));
        uint256 eb = address(inc).balance;
        assertGt(cb, 0);
        assertGt(eb, 0);
        vm.prank(alice);
        vm.expectRevert();
        inc.emergencyWithdraw(alice);
        vm.expectEmit(true, false, false, true, address(inc));
        emit Incorporations.EmergencyWithdrawn(treasury, cb, eb);
        vm.prank(admin);
        inc.emergencyWithdraw(treasury);
        assertEq(comd.balanceOf(treasury), cb);
        assertEq(treasury.balance, eb);
        assertEq(comd.balanceOf(address(inc)), 0);
        assertEq(inc.emergencyWithdrawAt(), 0);
        assertEq(inc.totalBacking(), cb, "accounting untouched");
        // trading cannot resume on an emptied curve
        uint256 owed = inc.totalLauncherEthOwed();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.Insolvent.selector, 0, cb, 0, owed));
        inc.unpause();
        // owner restores the backing (and launcher ETH) → unpause works and traders are whole
        vm.deal(treasury, eb);
        vm.startPrank(treasury);
        comd.transfer(address(inc), cb);
        (bool ok,) = address(inc).call{value: eb}("");
        assertTrue(ok);
        vm.stopPrank();
        vm.prank(admin);
        inc.unpause();
        uint256 aliceCoins = IERC20(coin).balanceOf(alice);
        uint256 q = inc.quoteSell(coin, aliceCoins);
        vm.prank(alice);
        assertEq(inc.sellForComd(coin, aliceCoins, q), q);
        vm.prank(launcher);
        assertEq(inc.claimLauncherEth(), 0.005 ether);
    }

    function test_swapperRotationRevokesOldApproval() public {
        address other = makeAddr("otherVenue");
        vm.prank(admin);
        inc.setSwapper(other);
        assertEq(comd.allowance(address(inc), address(swapper)), 0);
        assertEq(comd.allowance(address(inc), other), type(uint256).max);
    }
}
