// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {ContributorDistributor} from "../src/launch/ContributorDistributor.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";
import {LaunchToken} from "../src/launch/LaunchToken.sol";
import {UniswapV4PoolSwapper} from "../src/swap/UniswapV4PoolSwapper.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";
import {OracleConsumerExample} from "../src/oracle/OracleConsumerExample.sol";
import {OracleAttestationVerifier} from "../src/oracle/OracleAttestationVerifier.sol";
import {MockERC20, OtherNFT, MockSeaport} from "./mocks/Mocks.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";
import {Base} from "./utils/Base.sol";

/// @dev Forces ETH into a contract that has no receive() (selfdestruct).
contract ForceEth {
    constructor(address payable to) payable {
        selfdestruct(to);
    }
}

/// @notice V7 safety nets on the launch stack: pause, rescue of stranded assets, registrar rotation. Allocated
///         contributor tokens can never be rescued.
contract LaunchSafetyTest is Deployers, MerkleHelper {
    ProjectFactory f;
    ContributorDistributor cd;
    LaunchGuardHook guard;
    address admin = makeAddr("admin");
    address registrar = makeAddr("registrar");
    address lpOwner = makeAddr("lpOwner");
    address payer = makeAddr("payer");
    address w1 = makeAddr("w1");
    uint256 constant SUPPLY = 1_000_000_000e18;
    bytes32[] leaves;

    function setUp() public {
        deployFreshManagerAndRouters();
        f = new ProjectFactory(manager, admin, lpOwner);
        cd = f.contributorDistributor();
        address g = address(uint160(0x7777) << 144 | uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        deployCodeTo("LaunchGuardHook.sol:LaunchGuardHook", abi.encode(address(manager), address(f)), g);
        guard = LaunchGuardHook(g);
        vm.startPrank(admin);
        f.setGuardHook(IHooks(g));
        f.grantRole(f.REGISTRAR_ROLE(), registrar);
        f.setPairedConfig(address(0), true, 1 ether, 1_000 ether);
        vm.stopPrank();
        leaves.push(_contribLeaf(1, w1, SUPPLY * 600 / 10_000));
        leaves.push(_contribLeaf(1, makeAddr("w2"), SUPPLY * 400 / 10_000));
    }

    function _params() internal view returns (ProjectFactory.LaunchParams memory p) {
        p.kind = 0;
        p.name = "Acme";
        p.symbol = "ACME";
        p.fee = 10_000;
        p.initialMarketCap = 10 ether;
        p.poolBps = 8_800;
        p.remainderTo = payer;
        p.contributorRoot = _root(leaves);
        p.salt = keccak256("s");
    }

    function test_pauseStopsLaunchAndDeployNotLpOwners() public {
        vm.prank(registrar);
        (uint256 id,) = f.launch(_params());
        vm.prank(registrar);
        vm.expectRevert();
        f.pause();
        vm.prank(admin);
        f.pause();
        ProjectFactory.LaunchParams memory p = _params();
        p.salt = keccak256("t");
        vm.startPrank(registrar);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        f.launch(p);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        f.deployContract(bytes32("job"), bytes32(0), abi.encodePacked(type(LaunchToken).creationCode, abi.encode("X", "X", 1e18, payer)));
        vm.stopPrank();
        // LP owners keep their powers while paused
        vm.prank(lpOwner);
        f.collectFees(id, lpOwner);
        vm.prank(admin);
        f.unpause();
        vm.prank(registrar);
        (uint256 id2,) = f.launch(p);
        assertEq(id2, 2);
    }

    function test_rescueFactoryStrays() public {
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(f), 4e18);
        new ForceEth{value: 0.1 ether}(payable(address(f)));
        assertEq(address(f).balance, 0.1 ether);
        vm.startPrank(registrar);
        vm.expectRevert();
        f.rescueERC20(IERC20(address(t)), registrar, 4e18);
        vm.expectRevert();
        f.rescueETH(registrar, 0.1 ether);
        vm.stopPrank();
        vm.startPrank(admin);
        f.rescueERC20(IERC20(address(t)), lpOwner, 4e18);
        f.rescueETH(lpOwner, 0.1 ether);
        vm.stopPrank();
        assertEq(t.balanceOf(lpOwner), 4e18);
        assertEq(lpOwner.balance, 0.1 ether);
    }

    function test_distributorRescueNeverTouchesAllocations() public {
        vm.prank(registrar);
        (uint256 id, address token) = f.launch(_params());
        uint256 allocated = SUPPLY / 10;
        assertEq(cd.reserved(token), allocated);
        assertEq(IERC20(token).balanceOf(address(cd)), allocated);
        // nothing above the allocation → nothing to rescue
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ContributorDistributor.ExceedsSurplus.selector, 0, 1));
        f.rescueFromDistributor(token, admin, 1);
        // only through the factory (its admin)
        vm.prank(admin);
        vm.expectRevert(ContributorDistributor.NotFactory.selector);
        cd.rescue(token, admin, 1);
        vm.prank(registrar);
        vm.expectRevert();
        f.rescueFromDistributor(token, registrar, 1);
        // a stray transfer of the launch token is surplus
        vm.prank(payer);
        IERC20(token).transfer(address(cd), 1_000e18);
        vm.prank(admin);
        f.rescueFromDistributor(token, lpOwner, 1_000e18);
        assertEq(IERC20(token).balanceOf(lpOwner), 1_000e18);
        assertEq(IERC20(token).balanceOf(address(cd)), allocated, "allocation intact");
        // after a claim the reserved amount shrinks with it
        vm.warp(block.timestamp + 1 hours);
        cd.claim(id, w1, SUPPLY * 600 / 10_000, _proof(leaves, 0));
        assertEq(cd.reserved(token), allocated - SUPPLY * 600 / 10_000);
        // forced ETH comes out
        new ForceEth{value: 0.2 ether}(payable(address(cd)));
        vm.prank(admin);
        f.rescueFromDistributor(address(0), lpOwner, 0.2 ether);
        assertEq(lpOwner.balance, 0.2 ether);
    }

    function test_guardHookRescueOnlyFactoryAdmin() public {
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(guard), 2e18);
        vm.prank(registrar);
        vm.expectRevert(LaunchGuardHook.NotFactoryAdmin.selector);
        guard.rescueERC20(IERC20(address(t)), registrar, 2e18);
        vm.prank(admin);
        guard.rescueERC20(IERC20(address(t)), lpOwner, 2e18);
        assertEq(t.balanceOf(lpOwner), 2e18);
        // the hook's permission bits are untouched by the new function (address flags are what v4 checks)
        assertEq(uint160(address(guard)) & Hooks.ALL_HOOK_MASK, uint160(Hooks.BEFORE_INITIALIZE_FLAG));
    }

    function test_registrarRotation() public {
        address reg2 = makeAddr("registrar2");
        bytes32 role = f.REGISTRAR_ROLE();
        vm.startPrank(admin);
        f.revokeRole(role, registrar);
        f.grantRole(role, reg2);
        vm.stopPrank();
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, registrar, role));
        f.launch(_params());
        vm.prank(reg2);
        (uint256 id,) = f.launch(_params());
        assertEq(id, 1);
    }

    function test_ethPairingCanBeAddedAndRemovedByAdmin() public {
        vm.prank(admin);
        f.setPairedConfig(address(0), false, 0, 0);
        vm.prank(registrar);
        vm.expectRevert(ProjectFactory.PairedNotAllowed.selector);
        f.launch(_params());
        vm.prank(admin);
        f.setPairedConfig(address(0), true, 1 ether, 1_000 ether);
        vm.prank(registrar);
        f.launch(_params());
    }
}

contract SwapperAdapterOracleSafetyTest is Base {
    uint256 attesterPk = 0xA77E57;

    function setUp() public {
        setUpSystem();
        setUpV4Pool();
    }

    function test_swapperSweepLeftovers() public {
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(v4swapper), 3e18);
        new ForceEth{value: 0.05 ether}(payable(address(v4swapper)));
        assertEq(address(v4swapper).balance, 0.05 ether);
        vm.prank(alice);
        vm.expectRevert();
        v4swapper.sweep(address(t), alice);
        vm.startPrank(admin);
        assertEq(v4swapper.sweep(address(t), treasury), 3e18);
        assertEq(v4swapper.sweep(address(0), treasury), 0.05 ether);
        assertEq(v4swapper.sweep(address(0), treasury), 0, "nothing left is fine");
        vm.stopPrank();
        assertEq(t.balanceOf(treasury), 3e18);
        assertEq(treasury.balance, 0.05 ether);
        // swaps unaffected
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        assertGt(v4swapper.swapExactETHForComd{value: 0.1 ether}(0, alice, block.timestamp), 0);
    }

    function test_seaportAdapterRescueOwnerOnly() public {
        MockSeaport sp = new MockSeaport();
        SeaportAdapter ad = new SeaportAdapter(address(sp), admin);
        assertEq(ad.owner(), admin);
        vm.expectRevert(SeaportAdapter.ZeroAddress.selector);
        new SeaportAdapter(address(0), admin);
        MockERC20 t = new MockERC20("Stray", "S");
        t.mint(address(ad), 1e18);
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(ad).call{value: 0.2 ether}("");
        assertTrue(ok);
        OtherNFT o = new OtherNFT();
        o.mint(address(ad), 9);
        vm.startPrank(alice);
        vm.expectRevert();
        ad.rescueETH(alice, 0.2 ether);
        vm.expectRevert();
        ad.rescueERC20(IERC20(address(t)), alice, 1e18);
        vm.expectRevert();
        ad.rescueERC721(IERC721(address(o)), 9, alice);
        vm.stopPrank();
        vm.startPrank(admin);
        ad.rescueETH(treasury, 0.2 ether);
        ad.rescueERC20(IERC20(address(t)), treasury, 1e18);
        ad.rescueERC721(IERC721(address(o)), 9, treasury);
        vm.stopPrank();
        assertEq(treasury.balance, 0.2 ether);
        assertEq(t.balanceOf(treasury), 1e18);
        assertEq(o.ownerOf(9), treasury);
    }

    function test_attesterRotation() public {
        address attester = vm.addr(attesterPk);
        OracleConsumerExample consumer = new OracleConsumerExample(attester, admin);
        vm.warp(1_800_000_000);
        OracleAttestationVerifier.OracleAttestation memory a;
        a.requestId = keccak256("req");
        a.answerType = "bool";
        a.answer = abi.encode(true);
        a.issuedAt = uint64(block.timestamp - 1);
        a.expiresAt = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPk, consumer.digest(a));
        bytes memory sig = abi.encodePacked(r, s, v);
        // rotate: the old key is rejected, the new one accepted
        uint256 pk2 = 0xA77E58;
        vm.prank(alice);
        vm.expectRevert();
        consumer.setAttester(vm.addr(pk2));
        vm.prank(admin);
        consumer.setAttester(vm.addr(pk2));
        vm.expectRevert();
        consumer.submit(a, sig);
        (v, r, s) = vm.sign(pk2, consumer.digest(a));
        consumer.submit(a, abi.encodePacked(r, s, v));
        assertTrue(consumer.boolAnswer(a.requestId));
        vm.prank(admin);
        vm.expectRevert(OracleConsumerExample.ZeroAddress.selector);
        consumer.setAttester(address(0));
    }
}
