// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Base} from "./utils/Base.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";
import {OtherNFT, RugAdapter, MockSeaport} from "./mocks/Mocks.sol";

contract FlywheelTest is Base {
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        initSeedAndTrade(); // 20 ETH of buys → 1 ETH tax: 0.5 buyback / 0.5 sweep
        vm.prank(admin);
        counsel.reserveMint(seller, 3); // ids 1..3
    }

    function _list(uint256 id, uint256 price) internal {
        vm.startPrank(seller);
        counsel.setApprovalForAll(address(marketplace), true);
        marketplace.list(address(counsel), id, price);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ tax in

    function test_bucketsFromTax() public view {
        assertEq(flywheel.totalTaxIn(), 1 ether);
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether);
        assertEq(s, 0.5 ether);
        (uint16 bb, uint16 sb) = flywheel.bps();
        assertEq(bb, 5_000);
        assertEq(sb, 5_000);
    }

    function testFuzz_bucketsSumExactly(uint256 v, uint16 bb) public {
        v = bound(v, 0, 1_000 ether);
        bb = uint16(bound(bb, 0, 10_000));
        vm.prank(admin);
        flywheel.setBps(bb, uint16(10_000 - bb));
        (uint256 b0, uint256 s0) = flywheel.bucketBalances();
        vm.deal(address(hook), v);
        vm.prank(address(hook));
        flywheel.notifyTax{value: v}();
        (uint256 b1, uint256 s1) = flywheel.bucketBalances();
        assertEq((b1 - b0) + (s1 - s0), v, "buckets sum exactly");
        assertEq(b1 - b0, v * bb / 10_000);
        assertEq(flywheel.totalTaxIn(), b1 + s1, "flywheel conservation");
    }

    function test_onlyHookNotifies_strayEthRefused() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(Flywheel.NotHook.selector);
        flywheel.notifyTax{value: 1}();
        vm.prank(alice);
        (bool ok,) = address(flywheel).call{value: 1}("");
        assertFalse(ok, "stray ETH refused");
    }

    // ------------------------------------------------------------------ buyback

    function test_buybackIsUntaxedAndBurns() public {
        uint256 supply0 = comd.totalSupply();
        uint256 taxed0 = hook.totalTaxed();
        vm.prank(alice);
        vm.expectRevert(Flywheel.NotKeeper.selector);
        flywheel.buyback(0);
        vm.prank(address(flywheel));
        uint256 q = router.quoteETHForComd(0.5 ether); // untaxed quote for the flywheel
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.Buyback(0.5 ether, q);
        vm.prank(keeper);
        uint256 burned = flywheel.buyback(q);
        assertEq(burned, q);
        assertEq(supply0 - comd.totalSupply(), burned, "all bought COMD burned");
        assertEq(hook.totalTaxed(), taxed0, "the buyback itself is not taxed");
        assertEq(flywheel.totalBoughtBack(), 0.5 ether);
        assertEq(flywheel.totalBurned(), burned);
        assertEq(comd.balanceOf(address(flywheel)), 0);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0);
        _assertTaxConservation();
        vm.prank(keeper);
        vm.expectRevert(Flywheel.Empty.selector);
        flywheel.buyback(0);
    }

    function test_buybackSlippage() public {
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.buyback(type(uint256).max);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether, "bucket untouched on revert");
    }

    // ------------------------------------------------------------------ sweep

    function test_sweepWithinCapRefundsDifference() public {
        _list(2, 0.1 ether);
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.Swept(2, 0.1 ether);
        vm.prank(keeper);
        uint256 spent = flywheel.sweep(address(marketplace), "", 2, 0.25 ether);
        assertEq(spent, 0.1 ether);
        assertEq(counsel.ownerOf(2), address(flywheel));
        assertEq(seller.balance, 0.1 ether);
        (, uint256 s) = flywheel.bucketBalances();
        assertEq(s, 0.4 ether, "unused ETH back in the sweep bucket");
        assertEq(flywheel.totalSwept(), 1);
        assertEq(flywheel.sweepSpent(), 0.1 ether);
        uint256[] memory ids = flywheel.sweptTokenIds();
        assertEq(ids.length, 1);
        assertEq(ids[0], 2);
        _assertTaxConservation();
    }

    function test_sweepRefusedAboveCaps() public {
        _list(1, 0.2 ether);
        vm.prank(admin);
        flywheel.setMaxSweepPrice(0.15 ether);
        vm.startPrank(keeper);
        vm.expectRevert(Flywheel.PriceTooHigh.selector);
        flywheel.sweep(address(marketplace), "", 1, 0.2 ether);
        // listing above the keeper's own maxPrice: the marketplace refuses
        vm.expectRevert(MockMarketplace.PriceAboveMax.selector);
        flywheel.sweep(address(marketplace), "", 1, 0.15 ether);
        vm.stopPrank();
        vm.prank(admin);
        flywheel.setMaxSweepPrice(1 ether);
        vm.prank(keeper);
        vm.expectRevert(Flywheel.Empty.selector);
        flywheel.sweep(address(marketplace), "", 1, 0.6 ether); // more than the 0.5 ETH bucket
        assertEq(counsel.ownerOf(1), seller);
    }

    function test_sweepOnlyAllowlistedAdapterAndDelivery() public {
        RugAdapter rug = new RugAdapter();
        vm.prank(keeper);
        vm.expectRevert(Flywheel.AdapterNotAllowed.selector);
        flywheel.sweep(address(rug), "", 1, 0.1 ether);
        vm.prank(admin);
        flywheel.setAdapter(address(rug), true);
        vm.prank(keeper);
        vm.expectRevert(); // NotDelivered (rug kept the ETH but the whole call reverts)
        flywheel.sweep(address(rug), "", 1, 0.1 ether);
        (, uint256 s) = flywheel.bucketBalances();
        assertEq(s, 0.5 ether);
    }

    function test_onlyCounselAccepted() public {
        OtherNFT o = new OtherNFT();
        o.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(Flywheel.NotCounsel.selector);
        o.safeTransferFrom(alice, address(flywheel), 1);
    }

    function test_awardSwept() public {
        _list(1, 0.05 ether);
        _list(3, 0.05 ether);
        vm.startPrank(keeper);
        flywheel.sweep(address(marketplace), "", 1, 0.1 ether);
        flywheel.sweep(address(marketplace), "", 3, 0.1 ether);
        vm.stopPrank();
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.awardSwept(1, alice);
        vm.prank(admin);
        flywheel.awardSwept(1, alice);
        assertEq(counsel.ownerOf(1), alice);
        uint256[] memory ids = flywheel.sweptTokenIds();
        assertEq(ids.length, 1);
        assertEq(ids[0], 3);
        assertEq(flywheel.totalSwept(), 2, "cumulative count");
        vm.prank(admin);
        vm.expectRevert(Flywheel.NotSwept.selector);
        flywheel.awardSwept(1, alice);
    }

    function test_seaportAdapterSkeleton() public {
        MockSeaport sp = new MockSeaport();
        SeaportAdapter ad = new SeaportAdapter(address(sp));
        vm.prank(seller);
        counsel.approve(address(sp), 2);
        sp.setOrder(IERC721(address(counsel)), seller, 2, 0.12 ether);
        vm.prank(admin);
        flywheel.setAdapter(address(ad), true);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(SeaportAdapter.SelectorNotAllowed.selector, bytes4(0x12345678)));
        flywheel.sweep(address(ad), hex"12345678", 2, 0.2 ether);
        vm.prank(keeper);
        uint256 spent = flywheel.sweep(address(ad), abi.encodeWithSelector(bytes4(0xfb0f3ee1)), 2, 0.2 ether);
        assertEq(spent, 0.12 ether);
        assertEq(counsel.ownerOf(2), address(flywheel));
        assertEq(address(ad).balance, 0, "adapter holds nothing");
        _assertTaxConservation();
    }

    // ------------------------------------------------------------------ owner

    function test_ownerSetters() public {
        vm.startPrank(admin);
        vm.expectRevert(Flywheel.BadBps.selector);
        flywheel.setBps(5_000, 5_001);
        flywheel.setBps(10_000, 0);
        vm.expectRevert(Flywheel.AlreadySet.selector);
        flywheel.setHook(alice);
        vm.expectRevert(Flywheel.AlreadySet.selector);
        flywheel.setRouter(alice);
        flywheel.setKeeper(bob);
        vm.stopPrank();
        assertEq(flywheel.keeper(), bob);
        _buy(alice, 1 ether);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether + 0.05 ether, "new split applies to new tax only");
        vm.prank(alice);
        vm.expectRevert();
        flywheel.setMaxSweepPrice(100 ether);
    }
}
