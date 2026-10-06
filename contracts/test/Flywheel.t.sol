// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Base} from "./utils/Base.sol";
import {Flywheel} from "../src/Flywheel.sol";
import {MockMarketplace} from "../src/mocks/MockMarketplace.sol";
import {SeaportAdapter} from "../src/marketplace/SeaportAdapter.sol";
import {OtherNFT, RugAdapter, RugSwapper, ReentrantAdapter, ReentrantSwapper, MockSeaport} from "./mocks/Mocks.sol";

contract FlywheelTest is Base {
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        _tax(1 ether); // Pons payout forwarded: 0.5 buyback / 0.5 sweep
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

    function test_receiveSplitsIntoBuckets() public view {
        assertEq(flywheel.totalTaxIn(), 1 ether);
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether);
        assertEq(s, 0.5 ether);
        (uint16 bb, uint16 sb) = flywheel.bps();
        assertEq(bb, 5_000);
        assertEq(sb, 5_000);
        assertEq(address(flywheel).balance, 1 ether);
    }

    function test_anyoneCanSendAndNotifyTaxIsAlias() public {
        vm.deal(alice, 2 ether);
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.TaxIn(0.4 ether);
        vm.prank(alice);
        (bool ok,) = address(flywheel).call{value: 0.4 ether}("");
        assertTrue(ok);
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.TaxIn(0.6 ether);
        vm.prank(alice);
        flywheel.notifyTax{value: 0.6 ether}();
        assertEq(flywheel.totalTaxIn(), 2 ether);
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 1 ether);
        assertEq(s, 1 ether);
        // zero-value sends are harmless
        vm.prank(alice);
        flywheel.notifyTax{value: 0}();
        assertEq(flywheel.totalTaxIn(), 2 ether);
        _assertTaxConservation();
    }

    function testFuzz_bucketsSumExactly(uint256 v, uint16 bb) public {
        v = bound(v, 0, 1_000 ether);
        bb = uint16(bound(bb, 0, 10_000));
        vm.prank(admin);
        flywheel.setBps(bb, uint16(10_000 - bb));
        (uint256 b0, uint256 s0) = flywheel.bucketBalances();
        vm.deal(market, v);
        vm.prank(market);
        flywheel.notifyTax{value: v}();
        (uint256 b1, uint256 s1) = flywheel.bucketBalances();
        assertEq((b1 - b0) + (s1 - s0), v, "buckets sum exactly");
        assertEq(b1 - b0, v * bb / 10_000);
        assertEq(flywheel.totalTaxIn(), b1 + s1, "flywheel conservation");
        assertEq(address(flywheel).balance, b1 + s1);
    }

    // ------------------------------------------------------------------ buyback

    function test_buybackBurnsToDeadAddress() public {
        uint256 supply0 = comd.totalSupply();
        vm.prank(alice);
        vm.expectRevert(Flywheel.NotKeeper.selector);
        flywheel.buyback(0);
        uint256 q = swapper.quoteETHForComd(0.5 ether);
        assertEq(q, 0.5e8 ether);
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.Buyback(0.5 ether, q);
        vm.prank(keeper);
        uint256 burned = flywheel.buyback(q);
        assertEq(burned, q);
        assertEq(comd.totalSupply(), supply0, "no burn(): supply unchanged");
        assertEq(comd.balanceOf(DEAD), burned, "COMD parked at the dead address");
        assertEq(flywheel.totalBoughtBack(), 0.5 ether);
        assertEq(flywheel.totalBurned(), burned);
        assertEq(comd.balanceOf(address(flywheel)), 0);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0);
        _assertTaxConservation();
        vm.prank(keeper);
        vm.expectRevert(Flywheel.Empty.selector);
        flywheel.buyback(0);
        // owner may also trigger it
        _tax(0.2 ether);
        vm.prank(admin);
        flywheel.buyback(1);
        assertEq(flywheel.totalBoughtBack(), 0.6 ether);
    }

    function test_buybackSlippage() public {
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.buyback(type(uint256).max);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether, "bucket untouched on revert");
    }

    function test_buybackRefundReturnsToBucket() public {
        swapper.setRefundBps(2_000); // venue uses 80% of the ETH
        vm.prank(keeper);
        uint256 burned = flywheel.buyback(0);
        assertEq(burned, 0.4e8 ether);
        assertEq(flywheel.totalBoughtBack(), 0.4 ether);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.1 ether, "unused ETH back in the bucket, not counted as tax");
        assertEq(flywheel.totalTaxIn(), 1 ether);
        _assertTaxConservation();
    }

    function test_buybackMeasuresDeliveryNotReturnValue() public {
        RugSwapper rug = new RugSwapper();
        vm.prank(admin);
        flywheel.setSwapper(address(rug));
        vm.prank(keeper);
        vm.expectRevert(Flywheel.NothingReceived.selector);
        flywheel.buyback(0);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether);
    }

    function test_swapperNotSetAccumulates() public {
        Flywheel fw = new Flywheel(IERC20(address(comd)), IERC721(address(counsel)), admin, keeper);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(fw).call{value: 1 ether}("");
        assertTrue(ok, "ETH accepted before the swapper exists");
        (uint256 b, uint256 s) = fw.bucketBalances();
        assertEq(b, 0.5 ether);
        assertEq(s, 0.5 ether);
        vm.prank(keeper);
        vm.expectRevert(Flywheel.SwapperNotSet.selector);
        fw.buyback(0);
        vm.prank(alice);
        vm.expectRevert();
        fw.setSwapper(address(swapper));
        vm.prank(admin);
        fw.setSwapper(address(swapper));
        vm.prank(keeper);
        assertGt(fw.buyback(0), 0);
        // owner can disable buybacks again by pointing at 0
        vm.prank(admin);
        fw.setSwapper(address(0));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (ok,) = address(fw).call{value: 1 ether}("");
        vm.prank(keeper);
        vm.expectRevert(Flywheel.SwapperNotSet.selector);
        fw.buyback(0);
    }

    function test_setComdOnce() public {
        Flywheel fw = new Flywheel(IERC20(address(0)), IERC721(address(counsel)), admin, keeper);
        vm.prank(admin);
        fw.setSwapper(address(swapper));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(fw).call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(keeper);
        vm.expectRevert(Flywheel.ComdNotSet.selector);
        fw.buyback(0);
        vm.prank(alice);
        vm.expectRevert();
        fw.setComd(address(comd));
        vm.startPrank(admin);
        vm.expectRevert(Flywheel.ZeroAddress.selector);
        fw.setComd(address(0));
        fw.setComd(address(comd));
        vm.expectRevert(Flywheel.AlreadySet.selector);
        fw.setComd(address(comd));
        vm.stopPrank();
        assertEq(address(fw.comd()), address(comd));
        vm.prank(keeper);
        assertEq(fw.buyback(0), 0.5e8 ether);
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
        assertEq(flywheel.totalTaxIn(), 1 ether, "refund during the op is not tax");
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
        vm.expectEmit(true, true, false, true, address(flywheel));
        emit Flywheel.SweptAwarded(1, alice);
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

    // ------------------------------------------------------------------ re-entrancy

    /// A malicious marketplace adapter (even one that is also the keeper) tries to re-enter buyback, awardSwept
    /// and sweep in the middle of a sweep: every attempt hits the reentrancy guard; buckets stay conserved.
    function test_reentrantAdapterBlocked() public {
        ReentrantAdapter ra = new ReentrantAdapter();
        vm.startPrank(admin);
        flywheel.setAdapter(address(ra), true);
        flywheel.setKeeper(address(ra));
        counsel.reserveMint(address(ra), 3); // ids 4..6 held by the adapter
        vm.stopPrank();
        bytes[3] memory payloads = [
            abi.encodeCall(Flywheel.buyback, (0)),
            abi.encodeCall(Flywheel.awardSwept, (4, address(ra))),
            abi.encodeCall(Flywheel.sweep, (address(ra), bytes(""), 5, 0.01 ether))
        ];
        for (uint256 i; i < 3; ++i) {
            ra.arm(address(flywheel), payloads[i]);
            (uint256 b0, uint256 s0) = flywheel.bucketBalances();
            vm.prank(address(ra));
            flywheel.sweep(address(ra), "", i + 4, 0.1 ether);
            assertFalse(ra.reentered(), "re-entry must fail");
            if (i != 1) assertEq(bytes4(ra.reason()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
            (uint256 b1, uint256 s1) = flywheel.bucketBalances();
            assertEq(b1, b0);
            assertEq(s1, s0, "free delivery: full refund");
            assertEq(counsel.ownerOf(i + 4), address(flywheel));
        }
        _assertTaxConservation();
    }

    /// A malicious swapper tries to re-enter buyback / sweep during the buyback: blocked; the ETH it sends back
    /// during the op is a refund, never new tax.
    function test_reentrantSwapperBlocked() public {
        ReentrantSwapper rs = new ReentrantSwapper(IERC20(address(comd)));
        comd.transfer(address(rs), 100_000_000e18);
        vm.startPrank(admin);
        flywheel.setSwapper(address(rs));
        flywheel.setKeeper(address(rs)); // even a keeper-swapper cannot re-enter
        vm.stopPrank();
        rs.arm(address(flywheel), abi.encodeCall(Flywheel.buyback, (0)));
        vm.prank(admin); // owner may trigger buybacks too
        uint256 burned = flywheel.buyback(0);
        assertFalse(rs.reentered());
        assertEq(bytes4(rs.reason()), bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        assertEq(burned, 0.5 ether * 1e8);
        assertEq(comd.balanceOf(DEAD), burned);
        _assertTaxConservation();
    }

    // ------------------------------------------------------------------ owner

    function test_ownerSetters() public {
        vm.startPrank(admin);
        vm.expectRevert(Flywheel.BadBps.selector);
        flywheel.setBps(5_000, 5_001);
        vm.expectEmit(false, false, false, true, address(flywheel));
        emit Flywheel.BpsSet(10_000, 0);
        flywheel.setBps(10_000, 0);
        vm.expectRevert(Flywheel.AlreadySet.selector);
        flywheel.setComd(alice);
        flywheel.setKeeper(bob);
        vm.stopPrank();
        assertEq(flywheel.keeper(), bob);
        _tax(0.1 ether);
        (uint256 b,) = flywheel.bucketBalances();
        assertEq(b, 0.5 ether + 0.1 ether, "new split applies to new tax only");
        vm.prank(alice);
        vm.expectRevert();
        flywheel.setMaxSweepPrice(100 ether);
        vm.prank(alice);
        vm.expectRevert();
        flywheel.setBps(5_000, 5_000);
        // Ownable2Step
        vm.prank(admin);
        flywheel.transferOwnership(carol);
        assertEq(flywheel.owner(), admin);
        vm.prank(carol);
        flywheel.acceptOwnership();
        assertEq(flywheel.owner(), carol);
    }
}
