// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ProjectFactory} from "../src/launch/ProjectFactory.sol";
import {ContributorDistributor} from "../src/launch/ContributorDistributor.sol";
import {LaunchGuardHook} from "../src/launch/LaunchGuardHook.sol";
import {LaunchToken} from "../src/launch/LaunchToken.sol";
import {MockERC20} from "./mocks/Mocks.sol";
import {MerkleHelper} from "./utils/MerkleHelper.sol";

contract ProjectFactoryTest is Deployers, MerkleHelper {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    ProjectFactory f;
    ContributorDistributor cd;
    LaunchGuardHook guard;
    MockERC20 paired; // a second paired token (stands in for COMD in pairing tests)
    address admin = makeAddr("admin");
    address registrar = makeAddr("registrar");
    address lpOwner = makeAddr("lpOwner");
    address payer = makeAddr("payer");
    address w1 = makeAddr("w1");
    address w2 = makeAddr("w2");
    address seat1 = makeAddr("seat1");

    uint256 constant SUPPLY = 1_000_000_000e18;
    bytes32[] leaves;

    function setUp() public {
        deployFreshManagerAndRouters();
        paired = new MockERC20("Paired", "PAIR");
        f = new ProjectFactory(manager, admin, lpOwner);
        cd = f.contributorDistributor();
        address g = address(uint160(0x7777) << 144 | uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        deployCodeTo("LaunchGuardHook.sol:LaunchGuardHook", abi.encode(address(manager), address(f)), g);
        guard = LaunchGuardHook(g);
        vm.startPrank(admin);
        f.setGuardHook(IHooks(g));
        f.grantRole(f.REGISTRAR_ROLE(), registrar);
        f.setPairedConfig(address(0), true, 1 ether, 1_000 ether);
        f.setPairedConfig(address(paired), true, 100_000e18, 100_000_000e18);
        vm.stopPrank();
        // 2% equal among 2 working wallets (1% each), 8% among 4 seats (2% each) — built off-chain normally
        uint256 lid = 1;
        leaves.push(_contribLeaf(lid, w1, SUPPLY * 100 / 10_000 + SUPPLY * 200 / 10_000));
        leaves.push(_contribLeaf(lid, w2, SUPPLY * 100 / 10_000));
        leaves.push(_contribLeaf(lid, seat1, SUPPLY * 200 / 10_000));
        leaves.push(_contribLeaf(lid, makeAddr("seat2"), SUPPLY * 200 / 10_000));
        leaves.push(_contribLeaf(lid, makeAddr("seat3"), SUPPLY * 200 / 10_000));
    }

    function _params() internal view returns (ProjectFactory.LaunchParams memory p) {
        p.kind = 0;
        p.name = "Acme Holdings";
        p.symbol = "ACME";
        p.paired = address(0);
        p.fee = 10_000;
        p.initialMarketCap = 10 ether;
        p.poolBps = 8_800;
        p.remainderTo = payer;
        p.contributorRoot = _root(leaves);
        p.salt = keccak256("s");
    }

    function _launch(ProjectFactory.LaunchParams memory p) internal returns (uint256 id, address token) {
        vm.prank(registrar);
        (id, token) = f.launch(p);
    }

    function test_customTokenEthLaunch() public {
        (uint256 id, address token) = _launch(_params());
        assertEq(id, 1);
        LaunchToken t = LaunchToken(token);
        assertEq(t.totalSupply(), SUPPLY);
        assertEq(t.name(), "Acme Holdings");
        assertEq(t.balanceOf(address(cd)), SUPPLY / 10, "10% to contributors");
        assertEq(t.balanceOf(address(f)), 0);
        ProjectFactory.Launch memory l = f.launches(id);
        assertApproxEqAbs(l.poolAmount, SUPPLY * 8_800 / 10_000, 1e6, "88% seeded");
        assertEq(t.balanceOf(payer), SUPPLY - SUPPLY / 10 - l.poolAmount, "2% (+dust) to payer");
        assertEq(l.lpOwner, lpOwner);
        assertEq(address(l.key.hooks), address(guard));
        assertEq(cd.unlockAt(id), block.timestamp + 1 hours);

        // opening price: 10 ETH / 1B tokens → 1e8 tokens per ETH (token is currency1)
        (uint160 sqrtP, int24 tick,,) = manager.getSlot0(l.key.toId());
        assertGt(sqrtP, 0);
        int24 expected = f.openingTick(false, 10 ether, SUPPLY);
        assertLe(expected - tick, 200);
        assertGe(expected - tick, 0);

        // buyers can trade right away
        vm.deal(address(this), 1 ether);
        BalanceDelta d = swapRouter.swap{value: 0.1 ether}(
            l.key,
            SwapParams({zeroForOne: true, amountSpecified: -0.1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        assertGt(d.amount1(), 0);
        assertApproxEqRel(uint256(int256(d.amount1())), 0.1e8 * 1e18 * 99 / 100, 0.03e18);
    }

    function test_contributorClaimsAfterLock() public {
        (uint256 id, address token) = _launch(_params());
        uint256 amt = SUPPLY * 300 / 10_000;
        bytes32[] memory proof = _proof(leaves, 0);
        vm.expectRevert(abi.encodeWithSelector(ContributorDistributor.Locked.selector, uint64(block.timestamp + 1 hours)));
        cd.claim(id, w1, amt, proof);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ContributorDistributor.InvalidProof.selector);
        cd.claim(id, w1, amt + 1, proof);
        cd.claim(id, w1, amt, proof); // anyone may submit; paid to w1
        assertEq(IERC20(token).balanceOf(w1), amt);
        assertTrue(cd.claimed(id, w1));
        vm.expectRevert(ContributorDistributor.AlreadyClaimed.selector);
        cd.claim(id, w1, amt, proof);
        vm.prank(seat1);
        cd.claim(id, seat1, SUPPLY * 200 / 10_000, _proof(leaves, 2));
        assertEq(IERC20(token).balanceOf(seat1), SUPPLY * 200 / 10_000);
        vm.expectRevert(ContributorDistributor.UnknownLaunch.selector);
        cd.claim(99, w1, amt, proof);
        vm.expectRevert(ContributorDistributor.NotFactory.selector);
        cd.register(5, token, bytes32(0), 0, 0);
    }

    function test_secondPairedTokenAndPoolBpsMax() public {
        ProjectFactory.LaunchParams memory p = _params();
        p.paired = address(paired);
        p.initialMarketCap = 5_000_000e18;
        p.poolBps = 9_000;
        p.remainderTo = address(0); // allowed at 90%
        p.fee = 3000;
        (uint256 id, address token) = _launch(p);
        ProjectFactory.Launch memory l = f.launches(id);
        assertEq(l.key.tickSpacing, 60);
        bool tokenIs0 = token < address(paired);
        assertEq(Currency.unwrap(tokenIs0 ? l.key.currency0 : l.key.currency1), token);
        assertApproxEqAbs(l.poolAmount, SUPPLY * 9 / 10, 1e6);
        assertLt(l.remainderAmount, 1e6, "only dust left, sent to lpOwner");
    }

    function test_validation() public {
        ProjectFactory.LaunchParams memory p = _params();
        vm.prank(payer);
        vm.expectRevert();
        f.launch(p);

        vm.startPrank(registrar);
        p.poolBps = 999;
        vm.expectRevert(ProjectFactory.BadPoolBps.selector);
        f.launch(p);
        p.poolBps = 9_001;
        vm.expectRevert(ProjectFactory.BadPoolBps.selector);
        f.launch(p);
        p = _params();
        p.remainderTo = address(0);
        vm.expectRevert(ProjectFactory.RemainderRequired.selector);
        f.launch(p);
        p = _params();
        p.fee = 100;
        vm.expectRevert(ProjectFactory.BadFee.selector);
        f.launch(p);
        p = _params();
        p.paired = address(0xBEEF);
        vm.expectRevert(ProjectFactory.PairedNotAllowed.selector);
        f.launch(p);
        p = _params();
        p.initialMarketCap = 0.5 ether;
        vm.expectRevert(ProjectFactory.MarketCapOutOfBounds.selector);
        f.launch(p);
        p.initialMarketCap = 1_001 ether;
        vm.expectRevert(ProjectFactory.MarketCapOutOfBounds.selector);
        f.launch(p);
        p = _params();
        p.contributorRoot = bytes32(0);
        vm.expectRevert(ProjectFactory.NoRoot.selector);
        f.launch(p);
        p = _params();
        p.kind = 3; // evm_contracts: use deployContract
        vm.expectRevert(ProjectFactory.BadKind.selector);
        f.launch(p);
        p = _params();
        p.kind = 1;
        p.totalSupply = 5e26;
        vm.expectRevert(ProjectFactory.BadSupply.selector);
        f.launch(p);
        p = _params();
        p.totalSupply = 1e20;
        vm.expectRevert(ProjectFactory.BadSupply.selector);
        f.launch(p);
        p = _params();
        p.kind = 2;
        vm.expectRevert(ProjectFactory.BadHook.selector);
        f.launch(p);
        vm.stopPrank();
    }

    function test_customSupplyAndEvmProject() public {
        ProjectFactory.LaunchParams memory p = _params();
        p.totalSupply = 21_000_000e18;
        (, address token) = _launch(p);
        assertEq(IERC20(token).totalSupply(), 21_000_000e18);
        p = _params();
        p.kind = 1;
        p.salt = keccak256("other");
        (uint256 id2, address t2) = _launch(p);
        assertEq(IERC20(t2).totalSupply(), SUPPLY);
        assertEq(f.launches(id2).kind, 1);
    }

    function test_guardBlocksForeignInit() public {
        (uint256 id,) = _launch(_params());
        PoolKey memory k = f.launches(id).key;
        k.fee = 3000;
        k.tickSpacing = 60;
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(guard),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(LaunchGuardHook.NotFactory.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        manager.initialize(k, TickMath.getSqrtPriceAtTick(0));
    }

    function test_univ4HookKind() public {
        // the launch's own hook (here: a second guard deployed for the factory) at a flagged address
        address h = address(uint160(0x8888) << 144 | uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        deployCodeTo("LaunchGuardHook.sol:LaunchGuardHook", abi.encode(address(manager), address(f)), h);
        ProjectFactory.LaunchParams memory p = _params();
        p.kind = 2;
        p.hook = h;
        (uint256 id,) = _launch(p);
        assertEq(address(f.launches(id).key.hooks), h);
    }

    function test_lpOwnerPowers() public {
        (uint256 id, address token) = _launch(_params());
        PoolKey memory k = f.launches(id).key;
        vm.deal(address(this), 5 ether);
        swapRouter.swap{value: 1 ether}(
            k,
            SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.expectRevert(ProjectFactory.NotLpOwner.selector);
        f.collectFees(id, payer);
        vm.prank(lpOwner);
        (uint256 a0,) = f.collectFees(id, lpOwner);
        assertApproxEqRel(a0, 0.01 ether, 0.01e18, "1% fee in ETH");
        assertEq(lpOwner.balance, a0);

        address newOwner = makeAddr("newOwner");
        vm.prank(lpOwner);
        f.transferLpOwner(id, newOwner);
        uint128 liq = f.launches(id).liquidity;
        vm.prank(newOwner);
        (uint256 e, uint256 tk) = f.removeLiquidity(id, liq / 2, newOwner);
        assertGt(e + tk, 0);
        assertEq(IERC20(token).balanceOf(newOwner), tk);
        assertEq(f.launches(id).liquidity, liq - liq / 2);
    }

    function test_deployContract() public {
        bytes memory init = abi.encodePacked(type(LaunchToken).creationCode, abi.encode("X", "X", 1e18, payer));
        vm.prank(payer);
        vm.expectRevert();
        f.deployContract(bytes32("job"), bytes32(0), init);
        address predicted = f.computeAddress(bytes32(uint256(7)), keccak256(init));
        vm.prank(registrar);
        address a = f.deployContract(bytes32("job"), bytes32(uint256(7)), init);
        assertEq(a, predicted);
        assertEq(IERC20(a).balanceOf(payer), 1e18);
    }

    function test_adminPolicy() public {
        vm.startPrank(admin);
        vm.expectRevert(ProjectFactory.BadLock.selector);
        f.setPolicy(31 days, lpOwner);
        f.setPolicy(2 hours, payer);
        vm.expectRevert(ProjectFactory.AlreadySet.selector);
        f.setGuardHook(IHooks(address(1)));
        vm.expectRevert(ProjectFactory.MarketCapOutOfBounds.selector);
        f.setPairedConfig(address(paired), true, 0, 1);
        vm.stopPrank();
        assertEq(f.contributorLockSeconds(), 2 hours);
        assertEq(f.defaultLpOwner(), payer);
    }

    function testFuzz_launchAllocations(uint16 poolBps, uint256 cap) public {
        poolBps = uint16(bound(poolBps, 1_000, 9_000));
        cap = bound(cap, 1 ether, 1_000 ether);
        ProjectFactory.LaunchParams memory p = _params();
        p.poolBps = poolBps;
        p.initialMarketCap = cap;
        (uint256 id, address token) = _launch(p);
        ProjectFactory.Launch memory l = f.launches(id);
        assertEq(l.contributorAmount + l.poolAmount + l.remainderAmount, SUPPLY, "every token accounted for");
        assertEq(IERC20(token).balanceOf(address(f)), 0);
        assertLe(l.poolAmount, SUPPLY * poolBps / 10_000);
    }
}
