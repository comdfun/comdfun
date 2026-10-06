// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {CounselFixture} from "./utils/CounselFixture.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

contract CounselNFTTest is Test, MerkleHelper {
    CounselNFT n;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    bytes32[] leaves;

    function setUp() public {
        n = CounselFixture.deploy(admin, treasury, "https://api.example/agents/by-token/");
        leaves.push(_allowLeaf(alice));
        leaves.push(_allowLeaf(bob));
        leaves.push(_allowLeaf(makeAddr("x")));
        vm.prank(admin);
        n.setAllowlistRoot(_root(leaves));
    }

    function test_defaults() public view {
        assertEq(n.name(), "Counsel");
        assertEq(n.symbol(), "COUNSEL");
        assertEq(n.MAX_SUPPLY(), 2000);
        assertEq(n.phase(), 0);
        assertEq(n.price(), 0);
        assertEq(n.maxPerWallet(), 2);
        assertEq(n.totalSupply(), 0);
    }

    function test_closedPhaseBlocksMints() public {
        vm.prank(alice);
        vm.expectRevert(CounselNFT.MintClosed.selector);
        n.mint(1);
        bytes32[] memory p = _proof(leaves, 0);
        vm.prank(alice);
        vm.expectRevert(CounselNFT.MintClosed.selector);
        n.allowlistMint(1, p);
    }

    function test_allowlistPhase() public {
        vm.prank(admin);
        n.setPhase(1);
        vm.prank(alice);
        vm.expectRevert(CounselNFT.MintClosed.selector);
        n.mint(1);
        bytes32[] memory p = _proof(leaves, 0);
        vm.prank(alice);
        n.allowlistMint(2, p);
        assertEq(n.ownerOf(1), alice);
        assertEq(n.ownerOf(2), alice);
        assertEq(n.mintedBy(alice), 2);
        vm.prank(alice);
        vm.expectRevert(CounselNFT.WalletLimit.selector);
        n.allowlistMint(1, p);
        vm.prank(carol);
        vm.expectRevert(CounselNFT.InvalidProof.selector);
        n.allowlistMint(1, p);
    }

    function test_publicPhaseWithPrice() public {
        vm.startPrank(admin);
        n.setPhase(2);
        n.setPrice(0.01 ether);
        n.setMaxPerWallet(3);
        vm.stopPrank();
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(CounselNFT.WrongPayment.selector);
        n.mint{value: 0.01 ether}(2);
        vm.prank(carol);
        n.mint{value: 0.03 ether}(3);
        assertEq(n.balanceOf(carol), 3);
        assertEq(address(n).balance, 0.03 ether);
        n.withdraw();
        assertEq(treasury.balance, 0.03 ether);
        vm.prank(carol);
        vm.expectRevert(CounselNFT.ZeroQuantity.selector);
        n.mint(0);
    }

    function test_reserveMintAndSoldOut() public {
        vm.startPrank(admin);
        n.reserveMint(admin, 1999);
        assertEq(n.totalSupply(), 1999);
        assertEq(n.mintedBy(admin), 0);
        n.setPhase(2);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(CounselNFT.SoldOut.selector);
        n.mint(2);
        vm.prank(alice);
        n.mint(1);
        assertEq(n.ownerOf(2000), alice);
        vm.prank(admin);
        vm.expectRevert(CounselNFT.SoldOut.selector);
        n.reserveMint(admin, 1);
    }

    function test_onlyOwnerAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert();
        n.setPhase(2);
        vm.expectRevert();
        n.setPrice(1);
        vm.expectRevert();
        n.reserveMint(alice, 1);
        vm.expectRevert();
        n.setBaseURI("x");
        vm.stopPrank();
        vm.startPrank(admin);
        vm.expectRevert(CounselNFT.BadPhase.selector);
        n.setPhase(3);
        vm.expectRevert(CounselNFT.BadLimit.selector);
        n.setMaxPerWallet(0);
        vm.stopPrank();
    }

    function test_tokenURIAndFreeze() public {
        vm.startPrank(admin);
        n.reserveMint(alice, 42);
        assertEq(n.tokenURI(42), "https://api.example/agents/by-token/42.json");
        n.setBaseURI("https://api2.example/agents/by-token/");
        assertEq(n.tokenURI(1), "https://api2.example/agents/by-token/1.json");
        n.freezeMetadata();
        vm.expectRevert(CounselNFT.Frozen.selector);
        n.setBaseURI("x");
        vm.stopPrank();
        vm.expectRevert();
        n.tokenURI(43);
    }

    function test_royaltyAndTreasury() public {
        (address r, uint256 amt) = n.royaltyInfo(1, 1 ether);
        assertEq(r, treasury);
        assertEq(amt, 0.05 ether);
        address t2 = makeAddr("t2");
        vm.prank(admin);
        n.setTreasury(t2);
        (r,) = n.royaltyInfo(1, 1 ether);
        assertEq(r, t2);
        assertTrue(n.supportsInterface(0x2a55205a));
        assertTrue(n.supportsInterface(0x80ac58cd));
        assertTrue(n.supportsInterface(0x49064906));
    }

    function test_ownable2Step() public {
        vm.prank(admin);
        n.transferOwnership(bob);
        assertEq(n.owner(), admin);
        vm.prank(bob);
        n.acceptOwnership();
        assertEq(n.owner(), bob);
    }

    function testFuzz_walletLimit(uint8 maxPer, uint8 qty) public {
        maxPer = uint8(bound(maxPer, 1, 100));
        qty = uint8(bound(qty, 1, 120));
        vm.startPrank(admin);
        n.setPhase(2);
        n.setMaxPerWallet(maxPer);
        vm.stopPrank();
        vm.prank(carol);
        if (qty > maxPer) {
            vm.expectRevert(CounselNFT.WalletLimit.selector);
            n.mint(qty);
        } else {
            n.mint(qty);
            assertEq(n.balanceOf(carol), qty);
        }
    }
}
