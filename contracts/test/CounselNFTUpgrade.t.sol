// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {CounselNFTV2Mock} from "./mocks/CounselNFTV2Mock.sol";
import {MockERC20, OtherNFT} from "./mocks/Mocks.sol";
import {CounselFixture} from "./utils/CounselFixture.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

/// @notice V7 safety net A: the Counsel NFT is UUPS upgradeable by its owner (Admin) and nobody else.
contract CounselNFTUpgradeTest is Test, MerkleHelper {
    CounselNFT n;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        n = CounselFixture.deploy(admin, treasury, "https://api.example/agents/by-token/");
    }

    function _upgrade(address who, address impl, bytes memory data) internal {
        vm.prank(who);
        n.upgradeToAndCall(impl, data);
    }

    function test_proxyShape() public view {
        address impl = address(uint160(uint256(vm.load(address(n), ERC1967Utils.IMPLEMENTATION_SLOT))));
        assertTrue(impl != address(0), "implementation slot set");
        assertEq(n.implementation(), impl, "implementation() view reads the ERC-1967 slot");
        assertEq(n.name(), "Counsel");
        assertEq(n.symbol(), "COUNSEL");
        assertEq(n.owner(), admin);
        assertEq(n.treasury(), treasury);
        assertEq(n.MAX_SUPPLY(), 2000);
        assertEq(n.maxPerWallet(), 2);
        assertEq(n.totalMinted(), 0);
        assertEq(n.contractURI(), "https://api.example/agents/by-token/collection.json");
    }

    function test_upgradeKeepsEveryHolderAndSetting() public {
        // live state before the upgrade
        vm.startPrank(admin);
        n.setPhase(2);
        n.setPrice(0.01 ether);
        n.setMaxPerWallet(5);
        n.setBaseURI("https://api2.example/agents/by-token/");
        bytes32 root = keccak256("root");
        n.setAllowlistRoot(root);
        n.reserveMint(bob, 3); // ids 1..3
        vm.stopPrank();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        n.mint{value: 0.02 ether}(2); // ids 4, 5
        vm.prank(alice);
        n.approve(bob, 4);

        address oldImpl = n.implementation();
        CounselNFTV2Mock v2 = new CounselNFTV2Mock();
        _upgrade(admin, address(v2), abi.encodeCall(CounselNFTV2Mock.setMotto, ("fiat justitia")));

        assertEq(n.implementation(), address(v2));
        assertTrue(n.implementation() != oldImpl);
        CounselNFTV2Mock up = CounselNFTV2Mock(address(n));
        assertEq(up.version(), 2);
        assertEq(up.motto(), "fiat justitia");
        // holders / balances / approvals
        assertEq(n.ownerOf(1), bob);
        assertEq(n.ownerOf(4), alice);
        assertEq(n.balanceOf(bob), 3);
        assertEq(n.balanceOf(alice), 2);
        assertEq(n.getApproved(4), bob);
        assertEq(n.totalSupply(), 5);
        assertEq(n.mintedBy(alice), 2);
        // settings
        assertEq(n.phase(), 2);
        assertEq(n.price(), 0.01 ether);
        assertEq(n.maxPerWallet(), 5);
        assertEq(n.allowlistRoot(), root);
        assertEq(n.baseURI(), "https://api2.example/agents/by-token/");
        assertEq(n.tokenURI(4), "https://api2.example/agents/by-token/4.json");
        assertEq(n.owner(), admin);
        assertEq(n.treasury(), treasury);
        (address r, uint256 amt) = n.royaltyInfo(1, 1 ether);
        assertEq(r, treasury);
        assertEq(amt, 0.05 ether);
        assertEq(address(n).balance, 0.02 ether, "mint proceeds still in the proxy");
        // still mints and withdraws after the upgrade
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        n.mint{value: 0.01 ether}(1);
        assertEq(n.ownerOf(6), bob);
        n.withdraw();
        assertEq(treasury.balance, 0.03 ether);
    }

    function test_nonOwnerCannotUpgrade() public {
        CounselNFTV2Mock v2 = new CounselNFTV2Mock();
        address impl = n.implementation();
        vm.prank(alice);
        vm.expectRevert();
        n.upgradeToAndCall(address(v2), "");
        // a pending (not yet accepted) owner cannot either
        vm.prank(admin);
        n.transferOwnership(bob);
        vm.prank(bob);
        vm.expectRevert();
        n.upgradeToAndCall(address(v2), "");
        assertEq(n.implementation(), impl, "unchanged");
        vm.prank(bob);
        n.acceptOwnership();
        _upgrade(bob, address(v2), "");
        assertEq(n.implementation(), address(v2));
    }

    function test_initializeCannotRunAgain() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        n.initialize(alice, "x/", alice);
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        n.initialize(alice, "x/", alice);
        // nor through the upgrade call data
        CounselNFTV2Mock v2 = new CounselNFTV2Mock();
        vm.prank(admin);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        n.upgradeToAndCall(address(v2), abi.encodeCall(CounselNFT.initialize, (alice, "x/", alice)));
        assertEq(n.owner(), admin);
    }

    function test_implementationCannotBeInitializedOrUpgraded() public {
        CounselNFT impl = CounselNFT(n.implementation());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(alice, "x/", alice);
        assertEq(impl.owner(), address(0), "implementation has no owner");
        // UUPS: upgrade calls on the implementation itself are refused (onlyProxy)
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        impl.upgradeToAndCall(address(impl), "");
    }

    function test_upgradeToNonUupsImplementationIsRefused() public {
        // ERC1967Utils checks proxiableUUID on the new implementation: a plain contract cannot brick the proxy
        MockERC20 notUups = new MockERC20("x", "x");
        vm.prank(admin);
        vm.expectRevert();
        n.upgradeToAndCall(address(notUups), "");
    }

    function test_initializeRejectsZeroAddresses() public {
        CounselNFT impl = new CounselNFT();
        vm.expectRevert(CounselNFT.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(CounselNFT.initialize, (address(0), "u/", treasury)));
        vm.expectRevert(CounselNFT.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(CounselNFT.initialize, (admin, "u/", address(0))));
    }

    function test_renounceDisabled() public {
        vm.prank(alice);
        vm.expectRevert();
        n.renounceOwnership();
        vm.prank(admin);
        vm.expectRevert(CounselNFT.RenounceDisabled.selector);
        n.renounceOwnership();
        assertEq(n.owner(), admin);
    }

    function test_storageNamespaceConstant() public pure {
        bytes32 expected =
            keccak256(abi.encode(uint256(keccak256("comd.storage.CounselNFT")) - 1)) & ~bytes32(uint256(0xff));
        assertEq(expected, bytes32(0x7f20e33c2300d142d730871216527226b063fb87db091baafa9245b9b1f65400));
    }

    function test_rescueStrayAssets() public {
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(n), 5e18);
        OtherNFT o = new OtherNFT();
        o.mint(address(this), 7);
        o.transferFrom(address(this), address(n), 7); // unsafe push
        vm.prank(alice);
        vm.expectRevert();
        n.rescueERC20(IERC20(address(t)), alice, 5e18);
        vm.startPrank(admin);
        n.rescueERC20(IERC20(address(t)), treasury, 5e18);
        n.rescueERC721(IERC721(address(o)), 7, treasury);
        vm.stopPrank();
        assertEq(t.balanceOf(treasury), 5e18);
        assertEq(o.ownerOf(7), treasury);
    }
}
