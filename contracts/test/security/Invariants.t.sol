// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {Base} from "../utils/Base.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";
import {MockComd} from "../../src/mocks/MockComd.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {ContributorDistributor} from "../../src/launch/ContributorDistributor.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {Incorporations} from "../../src/Incorporations.sol";
import {MockMarketplace} from "../../src/mocks/MockMarketplace.sol";
import {MockERC20, MockSwapper} from "../mocks/Mocks.sol";

/// @notice Invariant campaigns (V6 / Pons mode): Flywheel bucket conservation, distributors never over-pay,
///         Incorporations reserve solvency.

// =====================================================================================================
// 1. Flywheel conservation: taxIn == Σ buckets + buyback spent + sweep spent; ETH balance == buckets; every COMD
//    bought back sits at the dead address; swept ids == count; sweep price cap
// =====================================================================================================

contract FlywheelHandler is Test {
    Flywheel public flywheel;
    MockSwapper public swapper;
    MockMarketplace public market;
    IERC721 public counsel;
    address public keeper;
    address public seller;
    address public payer = makeAddr("pons");
    uint256 public nextListing = 1;
    uint256 public maxListing;
    mapping(bytes32 => uint256) public ok; // successful calls per action (coverage check)

    constructor(Flywheel f, MockSwapper s, MockMarketplace m, IERC721 c, address keeper_, address seller_, uint256 n) {
        flywheel = f;
        swapper = s;
        market = m;
        counsel = c;
        keeper = keeper_;
        seller = seller_;
        maxListing = n;
    }

    /// Pons payout (or anyone) sends ETH; half of the time through the alias.
    function tax(uint256 eth, bool alias_) external {
        eth = bound(eth, 0, 5 ether);
        vm.deal(payer, payer.balance + eth);
        vm.prank(payer);
        if (alias_) {
            flywheel.notifyTax{value: eth}();
        } else {
            (bool s,) = address(flywheel).call{value: eth}("");
            require(s);
        }
        ++ok["tax"];
    }

    /// Venue conditions change: rate, partial fills, a hook tax on the ETH leg.
    function venue(uint256 rate, uint16 refund, uint16 hookTax) external {
        swapper.setRate(bound(rate, 1e6, 1e9) * 1e18);
        swapper.setRefundBps(uint16(bound(refund, 0, 5_000)));
        swapper.setEthTaxBps(uint16(bound(hookTax, 0, 1_000)));
    }

    function buyback(uint256 minOut) external {
        (uint256 b,) = flywheel.bucketBalances();
        minOut = bound(minOut, 0, swapper.quoteETHForComd(b) * 2);
        vm.prank(keeper);
        try flywheel.buyback(minOut) {
            ++ok["buyback"];
        } catch {}
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
        try flywheel.sweep(address(market), "", id, maxPrice) {
            ++ok["sweep"];
            ++nextListing;
        } catch {}
    }

    function award(uint256 i) external {
        uint256[] memory ids = flywheel.sweptTokenIds();
        if (ids.length == 0) return;
        vm.prank(flywheel.owner());
        flywheel.awardSwept(ids[i % ids.length], makeAddr("counsel-of-the-year"));
        ++ok["award"];
    }

    function setBps(uint16 b) external {
        b = uint16(bound(b, 0, 10_000));
        vm.prank(flywheel.owner());
        flywheel.setBps(b, uint16(10_000 - b));
    }
}

contract FlywheelConservationInvariant is Base {
    FlywheelHandler handler;
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        vm.prank(admin);
        counsel.reserveMint(seller, 20);
        handler = new FlywheelHandler(flywheel, swapper, marketplace, IERC721(address(counsel)), keeper, seller, 20);
        vm.prank(seller);
        counsel.setApprovalForAll(address(marketplace), true);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    /// forge-config: local.invariant.runs = 64
    /// forge-config: local.invariant.depth = 40
    function invariant_flywheelConservation() public view {
        _assertTaxConservation();
        assertEq(flywheel.sweptTokenIds().length + handler.ok("award"), flywheel.totalSwept());
        assertLe(flywheel.sweepSpent(), flywheel.totalSwept() * flywheel.maxSweepPrice(), "sweep price cap");
        assertEq(comd.totalSupply(), SUPPLY, "external token: nothing minted or burned");
    }

    /// Handler sanity: every action the campaign uses succeeds on its own (the campaign wraps them in try/catch).
    function test_handlerActionsAllSucceed() public {
        handler.tax(2 ether, false);
        handler.tax(1 ether, true);
        handler.venue(1e8, 1_000, 100);
        handler.buyback(0);
        handler.sweep(0.01 ether);
        handler.award(0);
        handler.setBps(7_000);
        handler.tax(1 ether, false);
        bytes32[4] memory tags = [bytes32("tax"), "buyback", "sweep", "award"];
        for (uint256 k; k < 4; ++k) {
            assertGt(handler.ok(tags[k]), 0, string(abi.encodePacked("action failed: ", tags[k])));
        }
        invariant_flywheelConservation();
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
    MockComd comd;
    CounselNFT counsel;
    RewardDistributor dist;
    DistributorHandler handler;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");

    function setUp() public {
        comd = new MockComd();
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
    MockComd comd;
    CounselNFT counsel;
    RewardDistributor dist;
    DistributorHandler handler;
    address admin = makeAddr("admin");
    address settler = makeAddr("settler");

    function setUp() public {
        tkn = new MockERC20("Other", "OTH");
        comd = new MockComd();
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
    IncHandler handler;

    function setUp() public {
        setUpSystem(); // Incorporations with the fixed-rate MockSwapper for the ETH legs
        handler = new IncHandler(inc, IERC20(address(comd)));
        comd.transfer(handler.traders(0), 10_000_000e18);
        comd.transfer(handler.traders(1), 10_000_000e18);
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
        assertEq(comd.balanceOf(DEAD), inc.totalBurned(), "dead address == burned");
        assertEq(comd.balanceOf(address(distributor)), inc.totalToRewards(), "1% fee lands in Counsel rewards");
        assertEq(comd.totalSupply(), SUPPLY, "external token: nothing minted or burned");
    }
}
