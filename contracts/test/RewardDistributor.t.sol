// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MockComd} from "../src/mocks/MockComd.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {RewardDistributor} from "../src/RewardDistributor.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

contract RewardDistributorTest is Test, MerkleHelper {
    MockComd comd;
    CounselNFT counsel;
    RewardDistributor dist;
    MockERC20 other;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32[] leaves;

    function setUp() public {
        comd = new MockComd();
        counsel = new CounselNFT(admin, admin, "u/");
        other = new MockERC20("Other", "OTH");
        dist = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        bytes32 role = dist.SETTLER_ROLE();
        vm.startPrank(admin);
        dist.grantRole(role, settler);
        counsel.reserveMint(alice, 1); // id 1
        counsel.reserveMint(bob, 1); // id 2
        vm.stopPrank();
        comd.transfer(address(dist), 1_000e18);
        other.mint(address(dist), 500e6);
        leaves.push(_seatLeaf(1, 1, 300e18));
        leaves.push(_seatLeaf(1, 2, 200e18));
        leaves.push(_seatLeaf(1, 3, 100e18));
    }

    function test_postAndClaimPaysCurrentOwner() public {
        vm.prank(settler);
        dist.postRoot(1, address(comd), _root(leaves), 600e18);
        assertEq(dist.unallocated(address(comd)), 400e18);
        address carol = makeAddr("carol");
        vm.prank(alice);
        counsel.transferFrom(alice, carol, 1);
        dist.claim(1, 1, 300e18, _proof(leaves, 0)); // anyone may submit
        assertEq(comd.balanceOf(carol), 300e18, "current owner paid");
        assertTrue(dist.claimed(1, 1));
        vm.expectRevert(RewardDistributor.AlreadyClaimed.selector);
        dist.claim(1, 1, 300e18, _proof(leaves, 0));
        vm.expectRevert(RewardDistributor.InvalidProof.selector);
        dist.claim(1, 2, 999e18, _proof(leaves, 1));
        dist.claim(1, 2, 200e18, _proof(leaves, 1));
        assertEq(comd.balanceOf(bob), 200e18);
        assertEq(dist.outstanding(address(comd)), 100e18);
    }

    function test_otherAssetRootSeparateFromComd() public {
        bytes32[] memory l = new bytes32[](2);
        l[0] = _seatLeaf(7, 1, 100e6);
        l[1] = _seatLeaf(7, 2, 50e6);
        vm.prank(settler);
        dist.postRoot(7, address(other), _root(l), 150e6);
        dist.claimToken(address(other), 7, 2, 50e6, _proof(l, 1));
        assertEq(other.balanceOf(bob), 50e6);
        assertTrue(dist.claimedToken(address(other), 7, 2));
        assertFalse(dist.claimed(7, 2));
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        dist.claim(7, 2, 50e6, _proof(l, 1));
    }

    function test_postRootGuards() public {
        vm.prank(alice);
        vm.expectRevert();
        dist.postRoot(1, address(comd), bytes32(uint256(1)), 1);
        vm.startPrank(settler);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 1_000e18, 1_001e18));
        dist.postRoot(1, address(comd), bytes32(uint256(1)), 1_001e18);
        dist.postRoot(1, address(comd), bytes32(uint256(1)), 1_000e18);
        vm.expectRevert(RewardDistributor.RootExists.selector);
        dist.postRoot(1, address(comd), bytes32(uint256(2)), 0);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 0, 1));
        dist.postRoot(2, address(comd), bytes32(uint256(1)), 1);
        vm.stopPrank();
    }

    function test_expireEpoch() public {
        vm.prank(settler);
        dist.postRoot(1, address(comd), _root(leaves), 600e18);
        dist.claim(1, 1, 300e18, _proof(leaves, 0));
        vm.prank(admin);
        vm.expectRevert(RewardDistributor.NotExpired.selector);
        dist.expireEpoch(1, address(comd));
        vm.warp(block.timestamp + 365 days);
        vm.prank(admin);
        dist.expireEpoch(1, address(comd));
        assertEq(dist.outstanding(address(comd)), 0);
        assertEq(dist.unallocated(address(comd)), 700e18);
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        dist.claim(1, 2, 200e18, _proof(leaves, 1));
    }

    function testFuzz_claimsNeverExceedRoot(uint96 a1, uint96 a2) public {
        uint256 x = bound(a1, 1, 500e18);
        uint256 y = bound(a2, 1, 500e18);
        bytes32[] memory l = new bytes32[](2);
        l[0] = _seatLeaf(9, 1, x);
        l[1] = _seatLeaf(9, 2, y);
        vm.prank(settler);
        dist.postRoot(9, address(comd), _root(l), x + y);
        dist.claim(9, 1, x, _proof(l, 0));
        dist.claim(9, 2, y, _proof(l, 1));
        assertEq(dist.outstanding(address(comd)), 0);
        assertEq(comd.balanceOf(address(dist)), 1_000e18 - x - y);
    }

    // ------------------------------------------------------------------ ETH (asset address(0))

    function test_ethRootAndClaim() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(dist).call{value: 3 ether}(""); // e.g. Flywheel.distribute()
        assertTrue(ok);
        assertEq(dist.unallocated(address(0)), 3 ether);
        bytes32[] memory l = new bytes32[](2);
        l[0] = _seatLeaf(4, 1, 2 ether);
        l[1] = _seatLeaf(4, 2, 1 ether);
        vm.prank(settler);
        dist.postRoot(4, address(0), _root(l), 3 ether);
        assertEq(dist.unallocated(address(0)), 0);
        // alice sold seat #1: the current owner is paid
        address carol = makeAddr("carol");
        vm.prank(alice);
        counsel.transferFrom(alice, carol, 1);
        dist.claimToken(address(0), 4, 1, 2 ether, _proof(l, 0));
        assertEq(carol.balance, 2 ether);
        assertTrue(dist.claimedToken(address(0), 4, 1));
        vm.expectRevert(RewardDistributor.AlreadyClaimed.selector);
        dist.claimToken(address(0), 4, 1, 2 ether, _proof(l, 0));
        dist.claimToken(address(0), 4, 2, 1 ether, _proof(l, 1));
        assertEq(bob.balance, 1 ether);
        assertEq(address(dist).balance, 0);
        assertEq(dist.outstanding(address(0)), 0);
    }

    function test_ethRootCannotExceedBalanceOrTotal() public {
        vm.deal(address(dist), 1 ether);
        bytes32[] memory l = new bytes32[](2);
        l[0] = _seatLeaf(5, 1, 1 ether);
        l[1] = _seatLeaf(5, 2, 1 ether);
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 1 ether, 2 ether));
        dist.postRoot(5, address(0), _root(l), 2 ether);
        vm.prank(settler);
        dist.postRoot(5, address(0), _root(l), 1 ether);
        dist.claimToken(address(0), 5, 1, 1 ether, _proof(l, 0));
        vm.expectRevert(RewardDistributor.ExceedsTotal.selector);
        dist.claimToken(address(0), 5, 2, 1 ether, _proof(l, 1));
    }

    function test_ethClaimToRejectingOwnerReverts() public {
        vm.deal(address(dist), 1 ether);
        // a seat held by a contract that refuses ETH cannot claim ETH (its owner must move the NFT first)
        RejectEth r = new RejectEth();
        vm.prank(alice);
        counsel.transferFrom(alice, address(r), 1);
        bytes32[] memory l = new bytes32[](2);
        l[0] = _seatLeaf(6, 1, 1 ether);
        l[1] = _seatLeaf(6, 99, 0);
        vm.prank(settler);
        dist.postRoot(6, address(0), _root(l), 1 ether);
        vm.expectRevert(RewardDistributor.TransferFailed.selector);
        dist.claimToken(address(0), 6, 1, 1 ether, _proof(l, 0));
    }
}

contract RejectEth {
    receive() external payable {
        revert("no");
    }
}
