// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";

import {Base} from "../utils/Base.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {ComdToken} from "../../src/ComdToken.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {ContributorDistributor} from "../../src/launch/ContributorDistributor.sol";
import {ComdTaxHook} from "../../src/ComdTaxHook.sol";
import {ComdRouter} from "../../src/ComdRouter.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {MockMarketplace} from "../../src/mocks/MockMarketplace.sol";
import {MockERC20} from "../mocks/Mocks.sol";
import {BuyWall} from "../../src/BuyWall.sol";
import {StakedComd} from "../../src/StakedComd.sol";
import {RewardDripper} from "../../src/RewardDripper.sol";
import {Incorporations, IComdRouterSwaps, IRewardDripperLike} from "../../src/Incorporations.sol";

// =====================================================================================================
// 1. Tax + trim conservation: taxIn == Σ buckets + spent; hook charged == Flywheel taxIn + pending claims;
//    every swap's tax is exactly 5% (exact-in buy / exact-in sell measured per call)
// =====================================================================================================

contract TaxHandler is Test {
    ComdTaxHook public hook;
    ComdRouter public router;
    Flywheel public flywheel;
    ComdToken public comd;
    PoolSwapTest public raw;
    MockMarketplace public market;
    IERC721 public counsel;
    address public keeper;
    address public seller;
    address[3] public traders;
    uint256 public nextListing = 1;
    uint256 public maxListing;
    uint256 public badTaxCalls; // swaps whose tax was not exactly 5%
    mapping(bytes32 => uint256) public ok; // successful calls per action (coverage check)

    constructor(ComdTaxHook h, ComdRouter r, Flywheel f, ComdToken c, PoolSwapTest raw_) {
        hook = h;
        router = r;
        flywheel = f;
        comd = c;
        raw = raw_;
        traders = [makeAddr("t1"), makeAddr("t2"), makeAddr("t3")];
        for (uint256 i; i < 3; ++i) {
            vm.startPrank(traders[i]);
            comd.approve(address(router), type(uint256).max);
            comd.approve(address(raw), type(uint256).max);
            vm.stopPrank();
        }
    }

    BuyWall public wall;

    receive() external payable {} // keeper tips from BuyWall.rebalance

    function setWall(BuyWall w) external {
        wall = w;
    }

    function initSweep(MockMarketplace m, IERC721 counsel_, address keeper_, address seller_, uint256 listings) external {
        market = m;
        counsel = counsel_;
        keeper = keeper_;
        seller = seller_;
        maxListing = listings;
    }

    function buy(uint256 t, uint256 eth) external {
        address who = traders[t % 3];
        eth = bound(eth, 1e9, 3 ether);
        vm.deal(who, who.balance + eth);
        uint256 t0 = hook.totalTaxed();
        vm.prank(who);
        try router.swapExactETHForComd{value: eth}(0, who, block.timestamp) { ++ok["buy"];
            if (hook.totalTaxed() - t0 != eth * 500 / 10_000) ++badTaxCalls;
        } catch {}
    }

    function sell(uint256 t, uint256 pct) external {
        address who = traders[t % 3];
        uint256 bal = comd.balanceOf(who);
        if (bal < 1e18) return;
        uint256 amt = bal * bound(pct, 1, 100) / 100;
        uint256 t0 = hook.totalTaxed();
        uint256 e0 = who.balance;
        vm.prank(who);
        try router.swapExactComdForETH(amt, 0, who, block.timestamp) { ++ok["sell"];
            uint256 net = who.balance - e0;
            uint256 tax = hook.totalTaxed() - t0;
            if (tax != (net + tax) * 500 / 10_000) ++badTaxCalls;
        } catch {}
    }

    function buyExactOut(uint256 t, uint256 amt) external {
        address who = traders[t % 3];
        amt = bound(amt, 1e18, 20_000_000e18);
        vm.deal(who, who.balance + 10 ether);
        PoolKey memory key = hook.poolKey();
        vm.prank(who);
        try raw.swap{value: 10 ether}(
            key,
            SwapParams({zeroForOne: true, amountSpecified: int256(amt), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {
            ++ok["buyExactOut"];
        } catch {}
    }

    function sellExactOut(uint256 t, uint256 eth) external {
        address who = traders[t % 3];
        if (comd.balanceOf(who) < 1e18) return;
        eth = bound(eth, 1e9, 0.5 ether);
        PoolKey memory key = hook.poolKey();
        vm.prank(who);
        try raw.swap(
            key,
            SwapParams({zeroForOne: false, amountSpecified: int256(eth), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {
            ++ok["sellExactOut"];
        } catch {}
    }

    function buyback() external {
        vm.prank(keeper);
        try flywheel.buyback(0) { ++ok["buyback"];} catch {}
    }

    function rebalanceWall() external {
        try wall.rebalance() {
            ++ok["wall"];
        } catch {}
    }

    /// Time passes: the cap decays (fast decay set in setUp), so later sells trim.
    function wait(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1 hours, 60 days));
        vm.roll(block.number + bound(dt, 1, 300));
    }

    function sweep(uint256 price) external {
        if (nextListing > maxListing) return;
        uint256 id = nextListing;
        price = bound(price, 0, 0.6 ether);
        vm.prank(seller);
        market.list(address(counsel), id, price);
        (, uint256 bucket) = flywheel.bucketBalances();
        uint256 maxPrice = bucket < 0.5 ether ? bucket : 0.5 ether;
        vm.prank(keeper);
        try flywheel.sweep(address(market), "", id, maxPrice) { ++ok["sweep"];
            ++nextListing;
        } catch {}
    }

    function flush() external {
        try hook.flush() { ++ok["flush"];} catch {}
    }

    function setBps(uint16 b) external {
        b = uint16(bound(b, 0, 10_000));
        vm.prank(flywheel.owner());
        flywheel.setBps(b, uint16(10_000 - b));
    }
}

contract TaxConservationInvariant is Base {
    function _selectors() internal view returns (FuzzSelector memory fs) {
        bytes4[] memory sel = new bytes4[](10);
        sel[0] = TaxHandler.buy.selector;
        sel[1] = TaxHandler.sell.selector;
        sel[2] = TaxHandler.buyExactOut.selector;
        sel[3] = TaxHandler.sellExactOut.selector;
        sel[4] = TaxHandler.buyback.selector;
        sel[5] = TaxHandler.rebalanceWall.selector;
        sel[6] = TaxHandler.sweep.selector;
        sel[7] = TaxHandler.flush.selector;
        sel[8] = TaxHandler.setBps.selector;
        sel[9] = TaxHandler.wait.selector;
        fs = FuzzSelector({addr: address(handler), selectors: sel});
    }

    TaxHandler handler;
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        initAndSeed(); // first buy inside the run will create claims (PoolManager starts with no ETH)
        vm.startPrank(admin);
        counsel.reserveMint(seller, 20);
        vm.stopPrank();
        handler = new TaxHandler(hook, router, flywheel, comd, swapRouter);
        handler.initSweep(marketplace, IERC721(address(counsel)), keeper, seller, 20);
        handler.setWall(wall);
        _fastDecay();
        targetSelector(_selectors());
        vm.prank(seller);
        counsel.setApprovalForAll(address(marketplace), true);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 40
    /// forge-config: local.invariant.runs = 48
    /// forge-config: local.invariant.depth = 40
    function invariant_taxAndTrimConservation() public view {
        _assertTaxConservation();
        _assertSplitConservation();
        assertEq(comd.balanceOf(address(wall)), 0, "wall holds no COMD at rest");
        assertEq(handler.badTaxCalls(), 0, "a swap was not taxed exactly 5%");
        assertEq(comd.balanceOf(address(flywheel)), 0, "flywheel holds no COMD (all buybacks burned)");
        assertEq(flywheel.sweptTokenIds().length, flywheel.totalSwept());
        assertLe(flywheel.sweepSpent(), flywheel.totalSwept() * flywheel.maxSweepPrice(), "sweep price cap");
    }

    /// Handler sanity: every action the campaign uses succeeds on its own (the campaign wraps them in try/catch).
    function test_handlerActionsAllSucceed() public {
        handler.buy(0, 2 ether);
        handler.buy(1, 1 ether);
        handler.flush();
        handler.sell(0, 50);
        handler.buyExactOut(1, 1_000_000e18);
        handler.sellExactOut(0, 0.01 ether);
        handler.buyback();
        handler.sweep(0.01 ether);
        for (uint256 w; w < 6; ++w) handler.wait(60 days); // the cap decays below the room the buys opened
        handler.sell(1, 100); // trims after the decay
        vm.deal(address(wall), address(wall).balance + 0.2 ether);
        handler.rebalanceWall();
        bytes32[8] memory tags =
            [bytes32("buy"), "sell", "buyExactOut", "sellExactOut", "buyback", "wall", "sweep", "flush"];
        for (uint256 k; k < 8; ++k) {
            assertGt(handler.ok(tags[k]), 0, string(abi.encodePacked("action failed: ", tags[k])));
        }
        assertGt(hook.stats().trimmedComd, 0, "a trim happened");
        invariant_taxAndTrimConservation();
    }
}

// =====================================================================================================
// 2. Distributors never pay more than funded (RewardDistributor per root + overall; ContributorDistributor)
// =====================================================================================================

contract DistributorHandler is Test, MerkleHelper {
    RewardDistributor public dist;

    receive() external payable {}
    ContributorDistributor public cdist;
    IERC20 public comd; // the ERC-20 under test (COMD or another ERC-20)
    address public settler;

    uint256 public epochs;
    mapping(uint256 => bytes32[]) internal _leaves;
    mapping(uint256 => uint256[4]) internal _amounts;
    uint256 public funded;
    uint256 public paid;

    uint256 public launches;
    mapping(uint256 => bytes32[]) internal _cLeaves;
    mapping(uint256 => uint256[4]) internal _cAmounts;
    address[4] internal _accts;
    uint256 public cRegistered;
    uint256 public cPaid;

    constructor(RewardDistributor d, IERC20 c, address settler_) {
        dist = d;
        comd = c;
        settler = settler_;
        cdist = new ContributorDistributor(address(this));
        comd.approve(address(cdist), type(uint256).max);
        _accts = [makeAddr("c1"), makeAddr("c2"), makeAddr("c3"), makeAddr("c4")];
    }

    // ETH (asset address(0)) bookkeeping, mirrored
    uint256 public ethEpochs;
    mapping(uint256 => bytes32[]) internal _eLeaves;
    mapping(uint256 => uint256[4]) internal _eAmounts;
    uint256 public ethFunded;
    uint256 public ethPaid;

    function fund(uint256 amt) external {
        amt = bound(amt, 1, comd.balanceOf(address(this)) / 100 + 1);
        if (amt > comd.balanceOf(address(this))) return;
        comd.transfer(address(dist), amt);
        funded += amt;
    }

    function fundEth(uint256 amt) external {
        amt = bound(amt, 1, 50 ether);
        (bool ok,) = address(dist).call{value: amt}("");
        require(ok);
        ethFunded += amt;
    }

    function postEth(uint256 seed, uint256 totalPct) external {
        uint256 avail = dist.unallocated(address(0));
        if (avail == 0) return;
        uint256 e = 1_000_000 + ++ethEpochs;
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            uint256 amt = uint256(keccak256(abi.encode(seed, i, "eth"))) % (avail / 2 + 1);
            _eAmounts[e][i] = amt;
            _eLeaves[e].push(_seatLeaf(e, i + 1, amt));
            sum += amt;
        }
        uint256 total = (sum * bound(totalPct, 0, 100)) / 100;
        if (total > avail) total = avail;
        vm.prank(settler);
        dist.postRoot(e, address(0), _root(_eLeaves[e]), total);
    }

    function claimEth(uint256 e, uint256 i) external {
        if (ethEpochs == 0) return;
        e = 1_000_000 + bound(e, 1, ethEpochs);
        i = i % 4;
        uint256 b0 = address(dist).balance;
        try dist.claimToken(address(0), e, i + 1, _eAmounts[e][i], _proof(_eLeaves[e], i)) {
            ethPaid += b0 - address(dist).balance;
        } catch {}
    }

    /// Posts a root whose leaves may sum to MORE than `total` (a faulty or malicious settler).
    function post(uint256 seed, uint256 totalPct) external {
        uint256 avail = dist.unallocated(address(comd));
        if (avail == 0) return;
        uint256 e = ++epochs;
        uint256 sum;
        for (uint256 i; i < 4; ++i) {
            uint256 amt = uint256(keccak256(abi.encode(seed, i))) % (avail / 2 + 1);
            _amounts[e][i] = amt;
            _leaves[e].push(_seatLeaf(e, i + 1, amt));
            sum += amt;
        }
        uint256 total = (sum * bound(totalPct, 0, 100)) / 100; // ≤ leaves' sum
        if (total > avail) total = avail;
        vm.prank(settler);
        dist.postRoot(e, address(comd), _root(_leaves[e]), total);
    }

    function claim(uint256 e, uint256 i) external {
        if (epochs == 0) return;
        e = bound(e, 1, epochs);
        i = i % 4;
        uint256 b0 = comd.balanceOf(address(dist));
        try dist.claimToken(address(comd), e, i + 1, _amounts[e][i], _proof(_leaves[e], i)) {
            paid += b0 - comd.balanceOf(address(dist));
        } catch {}
    }

    function register(uint256 seed, uint256 total) external {
        uint256 id = ++launches;
        total = bound(total, 1, comd.balanceOf(address(this)) / 100 + 1);
        if (total > comd.balanceOf(address(this))) return;
        for (uint256 i; i < 4; ++i) {
            uint256 amt = uint256(keccak256(abi.encode(seed, i))) % total; // sum may exceed total
            _cAmounts[id][i] = amt;
            _cLeaves[id].push(_contribLeaf(id, _accts[i], amt));
        }
        cdist.register(id, address(comd), _root(_cLeaves[id]), total, uint64(block.timestamp));
        cRegistered += total;
    }

    function cClaim(uint256 id, uint256 i) external {
        if (launches == 0) return;
        id = bound(id, 1, launches);
        i = i % 4;
        uint256 b0 = comd.balanceOf(address(cdist));
        try cdist.claim(id, _accts[i], _cAmounts[id][i], _proof(_cLeaves[id], i)) {
            cPaid += b0 - comd.balanceOf(address(cdist));
        } catch {}
    }
}

contract DistributorsInvariant is Test {
    ComdToken comd;
    CounselNFT counsel;
    RewardDistributor dist;
    DistributorHandler handler;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");

    function setUp() public {
        comd = new ComdToken(address(this));
        counsel = new CounselNFT(admin, admin, "u/");
        dist = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        bytes32 role = dist.SETTLER_ROLE();
        vm.startPrank(admin);
        dist.grantRole(role, settler);
        counsel.reserveMint(makeAddr("holder"), 4); // ids 1..4
        vm.stopPrank();
        handler = new DistributorHandler(dist, IERC20(address(comd)), settler);
        comd.transfer(address(handler), 9_000_000e18);
        vm.deal(address(handler), 1_000_000 ether);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    /// forge-config: local.invariant.runs = 64
    /// forge-config: local.invariant.depth = 40
    function invariant_neverPaysMoreThanFunded() public view {
        // RewardDistributor: each root ≤ its total; all payouts ≤ funding; committed balance always present
        uint256 sumClaimed;
        for (uint256 e = 1; e <= handler.epochs(); ++e) {
            RewardDistributor.Root memory rt = dist.roots(e, address(comd));
            assertLe(rt.claimed, rt.total, "root over-claimed");
            sumClaimed += rt.claimed;
        }
        assertEq(sumClaimed, handler.paid());
        assertLe(handler.paid(), handler.funded(), "paid > funded");
        assertGe(comd.balanceOf(address(dist)), dist.outstanding(address(comd)), "outstanding not covered");
        // ContributorDistributor: each launch ≤ its total; payouts ≤ registered
        ContributorDistributor cd = handler.cdist();
        for (uint256 id = 1; id <= handler.launches(); ++id) {
            ContributorDistributor.Allocation memory al = cd.allocations(id);
            assertLe(al.claimed, al.total, "launch over-claimed");
        }
        assertLe(handler.cPaid(), handler.cRegistered(), "contrib paid > registered");
        assertEq(comd.balanceOf(address(cd)), handler.cRegistered() - handler.cPaid());
        // ETH roots: same guarantees
        uint256 sumEth;
        for (uint256 e = 1; e <= handler.ethEpochs(); ++e) {
            RewardDistributor.Root memory rt = dist.roots(1_000_000 + e, address(0));
            assertLe(rt.claimed, rt.total, "eth root over-claimed");
            sumEth += rt.claimed;
        }
        assertEq(sumEth, handler.ethPaid());
        assertLe(handler.ethPaid(), handler.ethFunded(), "eth paid > funded");
        assertGe(address(dist).balance, dist.outstanding(address(0)), "eth outstanding not covered");
    }
}

/// Same guarantees with a second, non-COMD ERC-20 as the asset (the distributor is asset-agnostic).
contract DistributorsInvariantOtherToken is Test {
    MockERC20 tkn;
    ComdToken comd;
    CounselNFT counsel;
    RewardDistributor dist;
    DistributorHandler handler;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");

    function setUp() public {
        tkn = new MockERC20("Other", "OTH");
        comd = new ComdToken(address(this));
        counsel = new CounselNFT(admin, admin, "u/");
        dist = new RewardDistributor(IERC20(address(comd)), IERC721(address(counsel)), admin);
        bytes32 role = dist.SETTLER_ROLE();
        vm.startPrank(admin);
        dist.grantRole(role, settler);
        counsel.reserveMint(makeAddr("holder"), 4);
        vm.stopPrank();
        handler = new DistributorHandler(dist, IERC20(address(tkn)), settler);
        deal(address(tkn), address(handler), 1_000_000_000e6);
        vm.deal(address(handler), 1_000 ether);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 40
    /// forge-config: local.invariant.runs = 48
    /// forge-config: local.invariant.depth = 40
    function invariant_otherTokenNeverPaysMoreThanFunded() public view {
        uint256 sumClaimed;
        for (uint256 e = 1; e <= handler.epochs(); ++e) {
            RewardDistributor.Root memory rt = dist.roots(e, address(tkn));
            assertLe(rt.claimed, rt.total, "root over-claimed");
            sumClaimed += rt.claimed;
        }
        assertEq(sumClaimed, handler.paid());
        assertLe(handler.paid(), handler.funded());
        assertGe(tkn.balanceOf(address(dist)), dist.outstanding(address(tkn)));
    }
}

// =====================================================================================================
// 3. Incorporations — reserve solvency: sum over coins of "sell every outstanding coin" ≤ backing ≤ balance
// =====================================================================================================

contract IncHandler is Test {
    Incorporations public inc;
    IERC20 public comd;
    address[] public coinList;
    address[2] public traders;

    constructor(Incorporations inc_, IERC20 comd_) {
        inc = inc_;
        comd = comd_;
        traders = [makeAddr("t1"), makeAddr("t2")];
        for (uint256 i; i < 3; ++i) coinList.push(inc.create("Coin", "C", ""));
        for (uint256 t; t < 2; ++t) {
            vm.startPrank(traders[t]);
            comd.approve(address(inc), type(uint256).max);
            for (uint256 i; i < 3; ++i) IERC20(coinList[i]).approve(address(inc), type(uint256).max);
            vm.stopPrank();
        }
    }

    function coins() external view returns (address[] memory) {
        return coinList;
    }

    function buy(uint256 t, uint256 c, uint256 amt) external {
        address who = traders[t % 2];
        address coin = coinList[c % 3];
        uint256 bal = comd.balanceOf(who);
        if (bal < 1_000) return;
        amt = bound(amt, 1_000, bal > 500_000e18 ? 500_000e18 : bal);
        vm.prank(who);
        try inc.buyWithComd(coin, amt, 0) {} catch {}
    }

    function sell(uint256 t, uint256 c, uint256 amt) external {
        address who = traders[t % 2];
        address coin = coinList[c % 3];
        uint256 bal = IERC20(coin).balanceOf(who);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(who);
        try inc.sellForComd(coin, amt, 0) {} catch {}
    }

    function buyEth(uint256 t, uint256 c, uint256 amt) external {
        address who = traders[t % 2];
        amt = bound(amt, 0.001 ether, 2 ether);
        vm.deal(who, who.balance + amt);
        vm.prank(who);
        try inc.buyWithETH{value: amt}(coinList[c % 3], 0) {} catch {}
    }

    function sellEth(uint256 t, uint256 c, uint256 amt) external {
        address who = traders[t % 2];
        address coin = coinList[c % 3];
        uint256 bal = IERC20(coin).balanceOf(who);
        if (bal == 0) return;
        vm.prank(who);
        try inc.sellForETH(coin, bound(amt, 1, bal), 0) {} catch {}
    }
}

contract IncorporationsSolvencyInvariant is Base {
    Incorporations inc;
    IncHandler handler;

    function setUp() public {
        setUpSystem();
        initSeedAndTrade();
        inc = new Incorporations(
            ERC20Burnable(address(comd)), IComdRouterSwaps(address(router)), IRewardDripperLike(address(dripper)), admin
        );
        handler = new IncHandler(inc, IERC20(address(comd)));
        deal(address(comd), handler.traders(0), 10_000_000e18);
        deal(address(comd), handler.traders(1), 10_000_000e18);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 40
    /// forge-config: local.invariant.runs = 48
    /// forge-config: local.invariant.depth = 40
    function invariant_reserveSolvency() public view {
        address[] memory cs = handler.coins();
        uint256 sumReserve;
        uint256 sumSells;
        for (uint256 i; i < cs.length; ++i) {
            Incorporations.Coin memory c = inc.coinInfo(cs[i]);
            sumReserve += c.comdReserve;
            uint256 outstanding = inc.COIN_SUPPLY() - c.coinReserve;
            uint256 x = c.virtualComd + c.comdReserve;
            // gross COMPANY a sale of every outstanding coin would return (uncapped curve output)
            uint256 gross = (x * outstanding) / (c.coinReserve + outstanding);
            assertLe(gross, c.comdReserve, "coin can sell for more than its reserve");
            sumSells += gross;
        }
        assertEq(sumReserve, inc.totalBacking(), "per-coin reserves != totalBacking");
        assertLe(sumSells, inc.totalBacking(), "possible sells > backing");
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking(), "balance < backing");
    }
}

// =====================================================================================================
// 4. StakedComd (sCOMD) — share price never decreases (deposits/withdrawals round for the vault; rewards only add)
// =====================================================================================================

contract VaultHandler is Test {
    StakedComd public vault;
    RewardDripper public dripper;
    IERC20 public comd;
    address[3] public actors;
    uint256 public decreases;
    uint256 public maxDrop;

    constructor(StakedComd v, RewardDripper d, IERC20 c) {
        vault = v;
        dripper = d;
        comd = c;
        actors = [makeAddr("a1"), makeAddr("a2"), makeAddr("a3")];
        for (uint256 i; i < 3; ++i) {
            vm.prank(actors[i]);
            comd.approve(address(vault), type(uint256).max);
        }
        comd.approve(address(dripper), type(uint256).max);
    }

    function _price() internal view returns (uint256) {
        return vault.convertToAssets(1e24);
    }

    modifier checkPrice() {
        uint256 p0 = _price();
        _;
        uint256 p1 = _price();
        if (p1 < p0) {
            ++decreases;
            if (p0 - p1 > maxDrop) maxDrop = p0 - p1;
        }
    }

    function deposit(uint256 who, uint256 amt) external checkPrice {
        address a = actors[who % 3];
        if (comd.balanceOf(a) == 0) return;
        amt = bound(amt, 1, comd.balanceOf(a));
        if (vault.previewDeposit(amt) == 0) return;
        vm.prank(a);
        vault.deposit(amt, actors[(who / 3) % 3]);
    }

    function mint(uint256 who, uint256 shares) external checkPrice {
        address a = actors[who % 3];
        shares = bound(shares, 1, 1e30);
        if (vault.previewMint(shares) > comd.balanceOf(a)) return;
        vm.prank(a);
        vault.mint(shares, a);
    }

    function redeem(uint256 who, uint256 shares) external checkPrice {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0 || vault.lastDepositBlock(a) == block.number) return;
        shares = bound(shares, 1, bal);
        vm.prank(a);
        vault.redeem(shares, a, a);
    }

    function withdraw(uint256 who, uint256 assets) external checkPrice {
        address a = actors[who % 3];
        uint256 max = vault.maxWithdraw(a);
        if (max == 0 || vault.lastDepositBlock(a) == block.number) return;
        assets = bound(assets, 1, max);
        vm.prank(a);
        vault.withdraw(assets, a, a);
    }

    function transfer(uint256 who, uint256 shares) external checkPrice {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0 || vault.lastDepositBlock(a) == block.number) return;
        vm.prank(a);
        vault.transfer(actors[(who % 3 + 1) % 3], bound(shares, 1, bal));
    }

    function notify(uint256 amt) external checkPrice {
        uint256 bal = comd.balanceOf(address(this));
        if (bal == 0) return;
        amt = bound(amt, 1, bal < 10_000_000e18 ? bal : 10_000_000e18);
        dripper.notifyReward(amt);
    }

    function drip() external checkPrice {
        dripper.drip();
    }

    function donate(uint256 amt) external checkPrice {
        uint256 bal = comd.balanceOf(address(this));
        if (bal == 0) return;
        comd.transfer(address(vault), bound(amt, 1, bal < 10_000e18 ? bal : 10_000e18));
    }

    function wait(uint256 dt) external checkPrice {
        vm.warp(block.timestamp + bound(dt, 1, 3 hours));
        vm.roll(block.number + 1);
    }
}

contract VaultSharePriceInvariant is Test {
    ComdToken comd;
    StakedComd vault;
    RewardDripper dripper;
    VaultHandler handler;

    function setUp() public {
        comd = new ComdToken(address(this));
        vault = new StakedComd(IERC20(address(comd)), address(this));
        dripper = new RewardDripper(IERC20(address(comd)), address(vault), address(this));
        handler = new VaultHandler(vault, dripper, IERC20(address(comd)));
        for (uint256 i; i < 3; ++i) comd.transfer(handler.actors(i), 1_000_000e18);
        comd.transfer(address(handler), 5_000_000e18);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    /// forge-config: local.invariant.runs = 64
    /// forge-config: local.invariant.depth = 60
    function invariant_sharePriceNeverDecreases() public view {
        assertEq(handler.decreases(), 0, "share price decreased");
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 60
    /// forge-config: local.invariant.runs = 64
    /// forge-config: local.invariant.depth = 60
    function invariant_vaultSolvent() public view {
        assertGe(comd.balanceOf(address(vault)), vault.convertToAssets(vault.totalSupply()), "insolvent");
    }
}

