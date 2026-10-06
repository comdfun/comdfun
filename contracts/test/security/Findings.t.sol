// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {MockComd} from "../../src/mocks/MockComd.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {MockERC20} from "../mocks/Mocks.sol";
import {LaunchMath} from "../../src/libraries/LaunchMath.sol";

/// @notice Security review regressions still relevant in V6 / Pons mode (see contracts/SECURITY_REVIEW.md).
///         Findings about the removed own pool (C-01, H-01), sCOMD (M-02, I-01) and the dripper (L-01) are gone
///         with those contracts; Flywheel re-entrancy lives in test/Flywheel.t.sol.

/// M-03 — RewardDistributor claims are bounded by the root's `total` (also for ETH in V2).
contract M03_DistributorOverClaim is Test, MerkleHelper {
    MockComd comd;
    CounselNFT counsel;
    RewardDistributor dist;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        comd = new MockComd();
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
