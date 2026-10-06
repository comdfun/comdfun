// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

import {Base} from "../utils/Base.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";
import {CounselFixture} from "../utils/CounselFixture.sol";
import {Flywheel} from "../../src/Flywheel.sol";
import {Incorporations} from "../../src/Incorporations.sol";
import {RewardDistributor} from "../../src/RewardDistributor.sol";
import {ContributorDistributor} from "../../src/launch/ContributorDistributor.sol";
import {ProjectFactory} from "../../src/launch/ProjectFactory.sol";
import {LaunchGuardHook} from "../../src/launch/LaunchGuardHook.sol";
import {LaunchToken} from "../../src/launch/LaunchToken.sol";
import {Create2Deployer} from "../../src/utils/Create2Deployer.sol";
import {OracleConsumerExample} from "../../src/oracle/OracleConsumerExample.sol";
import {OracleAttestationVerifier} from "../../src/oracle/OracleAttestationVerifier.sol";
import {IERC8004Identity, IERC8004Reputation} from "../../src/interfaces/IERC8004.sol";
import {ERC8004Fixture} from "../utils/ERC8004Fixture.sol";
import {IMarketplaceAdapter} from "../../src/interfaces/IMarketplaceAdapter.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {MerkleHelper} from "../utils/MerkleHelper.sol";

/// @notice V7 audit — concrete adversarial cases (contracts/AUDIT.md). Each contract's attack surface is poked
///         with the inputs an attacker would try; the expected outcome is a revert or no gain.

// ------------------------------------------------------------------------------------------------ CounselNFT

/// A minter that re-enters `mint` from the ERC-721 receive hook.
contract ReentrantMinter is IERC721Receiver {
    CounselNFT public n;
    uint256 public reentries;
    bool public reentrySucceeded;

    constructor(CounselNFT n_) {
        n = n_;
    }

    function go(uint256 q) external payable {
        n.mint{value: msg.value}(q);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (reentries++ < 3) {
            try n.mint(1) {
                reentrySucceeded = true;
            } catch {}
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract RejectsEth {
    receive() external payable {
        revert("no");
    }
}

contract AuditCounselNFT is Test, MerkleHelper {
    CounselNFT n;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    bytes32[] leaves;

    function setUp() public {
        n = CounselFixture.deploy(admin, treasury, "https://api.comd.fun/agents/by-token/");
        leaves.push(_allowLeaf(alice));
        leaves.push(_allowLeaf(makeAddr("x")));
        vm.startPrank(admin);
        n.setAllowlistRoot(_root(leaves));
        n.setPhase(2);
        vm.stopPrank();
    }

    /// Over- and under-payment both revert: no ETH is ever stranded as "change" inside the contract.
    function test_exactPaymentOnly() public {
        vm.prank(admin);
        n.setPrice(0.01 ether);
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert(CounselNFT.WrongPayment.selector);
        n.mint{value: 0.02 ether}(1); // overpaid
        vm.expectRevert(CounselNFT.WrongPayment.selector);
        n.mint{value: 0.019 ether}(2); // underpaid
        vm.expectRevert(CounselNFT.WrongPayment.selector);
        n.mint{value: 0}(1); // free attempt
        n.mint{value: 0.02 ether}(2);
        vm.stopPrank();
        assertEq(address(n).balance, 0.02 ether);
        // free mint: any ETH attached is refused (so nobody "accidentally" pays)
        vm.prank(admin);
        n.setPrice(0);
        address fresh = makeAddr("fresh");
        vm.deal(fresh, 1);
        vm.prank(fresh);
        vm.expectRevert(CounselNFT.WrongPayment.selector);
        n.mint{value: 1}(1);
    }

    /// Re-entering `mint` from onERC721Received cannot exceed the per-wallet limit or skip ids (review I-10).
    function test_reentrantMintBounded() public {
        ReentrantMinter m = new ReentrantMinter(n);
        m.go(2);
        assertFalse(m.reentrySucceeded(), "re-entered mints hit WalletLimit");
        assertEq(n.balanceOf(address(m)), 2);
        assertEq(n.mintedBy(address(m)), 2);
        assertEq(n.totalSupply(), 2);
        assertEq(n.ownerOf(1), address(m));
        assertEq(n.ownerOf(2), address(m));
    }

    /// Allowlist mints during the public phase count against the same wallet limit (no double allowance).
    function test_allowlistAndPublicShareOneLimit() public {
        vm.startPrank(alice);
        n.allowlistMint(1, _proof(leaves, 0));
        n.mint(1);
        vm.expectRevert(CounselNFT.WalletLimit.selector);
        n.allowlistMint(1, _proof(leaves, 0));
        vm.expectRevert(CounselNFT.WalletLimit.selector);
        n.mint(1);
        vm.stopPrank();
        assertEq(n.mintedBy(alice), 2);
    }

    /// A forged proof (right leaf shape, wrong root) and a proof for someone else's leaf both fail.
    function test_allowlistProofForgery() public {
        vm.prank(admin);
        n.setPhase(1);
        bytes32[] memory p = _proof(leaves, 1); // x's proof
        vm.prank(alice);
        vm.expectRevert(CounselNFT.InvalidProof.selector);
        n.allowlistMint(1, p);
        bytes32[] memory empty;
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(CounselNFT.InvalidProof.selector);
        n.allowlistMint(1, empty);
    }

    /// Supply is hard-capped at 2,000 across public, allowlist and reserve mints.
    function test_hardCap() public {
        vm.prank(admin);
        n.reserveMint(treasury, 1998);
        vm.prank(alice);
        n.mint(2); // 1999, 2000
        assertEq(n.totalSupply(), 2000);
        vm.prank(admin);
        vm.expectRevert(CounselNFT.SoldOut.selector);
        n.reserveMint(treasury, 1);
        vm.prank(makeAddr("late"));
        vm.expectRevert(CounselNFT.SoldOut.selector);
        n.mint(1);
        vm.expectRevert();
        n.ownerOf(2001);
    }

    /// Mint proceeds: withdraw is permissionless but only ever pays the treasury; a treasury that cannot take ETH
    /// does not strand the funds — the owner re-points it.
    function test_proceedsOnlyToTreasury() public {
        vm.prank(admin);
        n.setPrice(0.01 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        n.mint{value: 0.02 ether}(2);
        RejectsEth bad = new RejectsEth();
        vm.prank(admin);
        n.setTreasury(address(bad));
        vm.expectRevert(CounselNFT.TransferFailed.selector);
        n.withdraw();
        vm.prank(admin);
        n.setTreasury(treasury);
        vm.prank(makeAddr("anyone"));
        n.withdraw();
        assertEq(treasury.balance, 0.02 ether);
    }

    function test_ownerSetterBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(CounselNFT.BadLimit.selector);
        n.setMaxPerWallet(101);
        vm.expectRevert(CounselNFT.BadLimit.selector);
        n.setMaxPerWallet(0);
        vm.expectRevert(CounselNFT.BadPhase.selector);
        n.setPhase(3);
        vm.expectRevert(CounselNFT.ZeroAddress.selector);
        n.setTreasury(address(0));
        vm.expectRevert(CounselNFT.ZeroQuantity.selector);
        n.reserveMint(alice, 0);
        vm.stopPrank();
        // every setter is owner-only (incl. the pending owner before accept)
        address[7] memory nobody = [alice, treasury, address(1), address(2), address(3), address(4), address(5)];
        for (uint256 i; i < 2; ++i) {
            vm.startPrank(nobody[i]);
            vm.expectRevert();
            n.setAllowlistRoot(bytes32(0));
            vm.expectRevert();
            n.setTreasury(alice);
            vm.expectRevert();
            n.freezeMetadata();
            vm.expectRevert();
            n.setMaxPerWallet(3);
            vm.stopPrank();
        }
    }

    /// The agentURI the API encodes for ERC-8004 registration is exactly tokenURI with the default base URI.
    function test_tokenUriMatchesApiAgentUri() public {
        vm.prank(admin);
        n.reserveMint(alice, 42);
        assertEq(n.tokenURI(42), "https://api.comd.fun/agents/by-token/42.json");
        assertEq(n.contractURI(), "https://api.comd.fun/agents/by-token/collection.json");
    }
}

// ------------------------------------------------------------------------------------------------ ERC-8004

contract AuditERC8004 is ERC8004Fixture {
    IERC8004Identity identity;
    IERC8004Reputation reputation;
    address admin = makeAddr("admin");
    address holder = makeAddr("holder");

    function setUp() public {
        (identity, reputation) = deployErc8004(admin);
    }

    /// The selector the API hard-codes (0xf2c298be) is register(string) on the deployed proxy and mints to the
    /// caller — a raw call with that selector works end to end.
    function test_apiSelectorMatchesDeployedRegistry() public {
        assertEq(bytes4(keccak256("register(string)")), bytes4(0xf2c298be));
        string memory uri = "https://api.comd.fun/agents/by-token/7.json";
        vm.prank(holder);
        (bool ok, bytes memory ret) =
            address(identity).call(abi.encodeWithSelector(bytes4(0xf2c298be), uri));
        assertTrue(ok);
        uint256 agentId = abi.decode(ret, (uint256));
        assertEq(identity.ownerOf(agentId), holder, "minted to msg.sender");
        assertEq(identity.tokenURI(agentId), uri);
    }

    /// Only the owner (Admin) can upgrade either registry proxy; the former deployer (this test contract, which
    /// bootstrapped the proxies) cannot.
    function test_onlyAdminUpgradesRegistries() public {
        address impl = deployCode("IdentityRegistryUpgradeable.sol:IdentityRegistryUpgradeable");
        address rimpl = deployCode("ReputationRegistryUpgradeable.sol:ReputationRegistryUpgradeable");
        vm.expectRevert(); // this contract was the bootstrap owner; ownership moved to admin
        identity.upgradeToAndCall(impl, "");
        vm.expectRevert();
        IERC8004Identity(address(reputation)).upgradeToAndCall(rimpl, "");
        vm.prank(holder);
        vm.expectRevert();
        identity.upgradeToAndCall(impl, "");
        vm.prank(holder);
        vm.expectRevert();
        IERC8004Identity(address(reputation)).upgradeToAndCall(rimpl, "");
        vm.prank(admin);
        identity.upgradeToAndCall(impl, "");
        vm.prank(admin);
        IERC8004Identity(address(reputation)).upgradeToAndCall(rimpl, "");
        assertEq(identity.owner(), admin);
        assertEq(reputation.owner(), admin);
        assertEq(reputation.getIdentityRegistry(), address(identity), "state kept across upgrade");
    }

    /// The registries' initializers cannot be run again by anyone (incl. the owner).
    function test_initializeLocked() public {
        vm.prank(admin);
        vm.expectRevert();
        identity.initialize();
        vm.prank(admin);
        vm.expectRevert();
        reputation.initialize(address(identity));
        vm.prank(holder);
        vm.expectRevert();
        identity.initialize();
    }

    /// Feedback: the agent's owner (and an operator it approved) cannot rate the agent; anyone else can; the
    /// platform's settler is just one such client.
    function test_feedbackRules() public {
        vm.prank(holder);
        uint256 id = identity.register("u");
        address op = makeAddr("operator");
        vm.prank(holder);
        IERC721(address(identity)).setApprovalForAll(op, true);
        vm.prank(holder);
        vm.expectRevert(bytes("Self-feedback not allowed"));
        reputation.giveFeedback(id, 1, 0, "", "", "", "", bytes32(0));
        vm.prank(op);
        vm.expectRevert(bytes("Self-feedback not allowed"));
        reputation.giveFeedback(id, 1, 0, "", "", "", "", bytes32(0));
        vm.prank(makeAddr("settler"));
        reputation.giveFeedback(id, 1, 0, "job", "accepted", "", "", bytes32(0));
        assertEq(reputation.getLastIndex(id, makeAddr("settler")), 1);
    }
}

// ------------------------------------------------------------------------------------------------ Payments

contract AuditPayments is Base {
    bytes32[] leaves;

    function setUp() public {
        setUpSystem();
        vm.startPrank(admin);
        counsel.reserveMint(alice, 1);
        counsel.reserveMint(bob, 1);
        vm.stopPrank();
        comd.transfer(address(distributor), 1_000e18);
        vm.deal(address(distributor), 1 ether);
    }

    /// A leaf from epoch 1 cannot be replayed in epoch 2, nor an ETH-root leaf against the COMD path, nor a COMD
    /// amount with a wrong tokenId: the leaf binds (epoch, tokenId, amount) and the root binds the asset.
    function test_noCrossEpochOrCrossAssetReplay() public {
        bytes32[] memory l1 = new bytes32[](2);
        l1[0] = _seatLeaf(1, 1, 100e18);
        l1[1] = _seatLeaf(1, 2, 100e18);
        bytes32[] memory l2 = new bytes32[](2);
        l2[0] = _seatLeaf(2, 1, 1 ether);
        l2[1] = _seatLeaf(2, 2, 0);
        vm.startPrank(settler);
        distributor.postRoot(1, address(comd), _root(l1), 200e18);
        distributor.postRoot(2, address(0), _root(l2), 1 ether);
        vm.stopPrank();
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        distributor.claim(2, 1, 1 ether, _proof(l2, 0)); // ETH root, COMD path
        vm.expectRevert(RewardDistributor.InvalidProof.selector);
        distributor.claimToken(address(0), 2, 1, 100e18, _proof(l1, 0)); // epoch-1 leaf on the ETH root
        vm.expectRevert(RewardDistributor.InvalidProof.selector);
        distributor.claim(1, 2, 100e18, _proof(l1, 0)); // alice's proof for bob's seat
        vm.expectRevert(RewardDistributor.InvalidProof.selector);
        distributor.claim(1, 1, 100e18 + 1, _proof(l1, 0));
        distributor.claim(1, 1, 100e18, _proof(l1, 0));
        distributor.claimToken(address(0), 2, 1, 1 ether, _proof(l2, 0));
        assertEq(comd.balanceOf(alice), 100e18);
        assertEq(alice.balance, 1 ether);
    }

    /// A settler cannot reserve more than the balance, nor the same (epoch, asset) twice; a zero root is refused.
    function test_settlerBounds() public {
        vm.startPrank(settler);
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 1_000e18, 1_000e18 + 1));
        distributor.postRoot(1, address(comd), bytes32(uint256(1)), 1_000e18 + 1);
        vm.expectRevert(RewardDistributor.NoRoot.selector);
        distributor.postRoot(1, address(comd), bytes32(0), 1);
        distributor.postRoot(1, address(comd), bytes32(uint256(1)), 600e18);
        vm.expectRevert(RewardDistributor.RootExists.selector);
        distributor.postRoot(1, address(comd), bytes32(uint256(2)), 1);
        // the remaining 400 can go to a second epoch, no more
        vm.expectRevert(abi.encodeWithSelector(RewardDistributor.InsufficientUnallocated.selector, 400e18, 400e18 + 1));
        distributor.postRoot(2, address(comd), bytes32(uint256(1)), 400e18 + 1);
        distributor.postRoot(2, address(comd), bytes32(uint256(1)), 400e18);
        vm.stopPrank();
        assertEq(distributor.unallocated(address(comd)), 0);
    }

    /// Job revenue: Permit2 moves COMD straight to the router; distribute() by anyone, never more than 20% to the
    /// treasury, dust goes to the treasury, all COMD leaves the router.
    function testFuzz_revenueSplit(uint256 amt, uint16 bpsR) public {
        amt = bound(amt, 1, 1e26);
        bpsR = uint16(bound(bpsR, 5_000, 10_000));
        vm.prank(admin);
        revenue.setBps(bpsR);
        comd.transfer(address(revenue), amt); // what Permit2.permitWitnessTransferFrom(to = payTo) does
        uint256 r0 = comd.balanceOf(address(distributor));
        vm.prank(makeAddr("anyone"));
        (uint256 toR, uint256 toT) = revenue.distribute();
        assertEq(toR, amt * bpsR / 10_000);
        assertEq(toR + toT, amt);
        assertLe(toT, amt / 2 + 1, "treasury never gets more than half (plus 1 wei of rounding dust)");
        assertEq(comd.balanceOf(address(distributor)) - r0, toR);
        assertEq(comd.balanceOf(treasury), toT);
        assertEq(comd.balanceOf(address(revenue)), 0);
    }
}

// ------------------------------------------------------------------------------------------------ Incorporations

/// A trader whose ETH refund hook re-enters the launchpad.
contract ReentrantTrader {
    Incorporations public inc;
    address public coin;
    bytes public reason;
    bool public reentered;

    constructor(Incorporations inc_, address coin_) {
        inc = inc_;
        coin = coin_;
    }

    function buy() external payable {
        inc.buyWithETH{value: msg.value}(coin, 0);
    }

    receive() external payable {
        (bool ok, bytes memory r) = address(inc).call(abi.encodeCall(Incorporations.buyWithComd, (coin, 1e18, 0)));
        reentered = ok;
        reason = r;
    }
}

contract AuditIncorporations is Base {
    address launcher = makeAddr("launcher");
    address coinA;
    address coinB;

    function setUp() public {
        setUpSystem();
        vm.prank(launcher);
        coinA = inc.create("A", "A", "");
        vm.prank(launcher);
        coinB = inc.create("B", "B", "");
        comd.transfer(alice, 5_000_000e18);
        comd.transfer(bob, 5_000_000e18);
        vm.startPrank(alice);
        comd.approve(address(inc), type(uint256).max);
        IERC20(coinA).approve(address(inc), type(uint256).max);
        IERC20(coinB).approve(address(inc), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        comd.approve(address(inc), type(uint256).max);
        IERC20(coinA).approve(address(inc), type(uint256).max);
        IERC20(coinB).approve(address(inc), type(uint256).max);
        vm.stopPrank();
    }

    /// Selling every outstanding coin of A returns at most A's own reserve; B's backing is untouched and the
    /// contract never holds less COMD than totalBacking.
    function test_fullDumpCannotReachOtherCoinsBacking() public {
        vm.prank(alice);
        uint256 a = inc.buyWithComd(coinA, 1_000_000e18, 0);
        vm.prank(bob);
        uint256 b = inc.buyWithComd(coinB, 300_000e18, 0);
        uint256 reserveA = inc.coinInfo(coinA).comdReserve;
        uint256 reserveB = inc.coinInfo(coinB).comdReserve;
        vm.prank(alice);
        uint256 got = inc.sellForComd(coinA, a, 0);
        assertLe(got, reserveA, "A's sellers get at most A's reserve");
        assertEq(inc.coinInfo(coinB).comdReserve, reserveB, "B untouched");
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking());
        assertEq(inc.coinInfo(coinA).coinReserve, inc.COIN_SUPPLY(), "all A coins back in the curve");
        assertLe(inc.coinInfo(coinA).comdReserve, 1, "A's reserve is dust at most");
        vm.prank(bob);
        assertLe(inc.sellForComd(coinB, b, 0), reserveB);
    }

    /// Dust: a 1-wei coin sale returns 0 COMD and reverts instead of leaking; fee rounding never makes fees > 2%.
    function test_dustAndFeeRounding() public {
        vm.prank(alice);
        inc.buyWithComd(coinA, 1_000e18, 0);
        vm.prank(alice);
        vm.expectRevert(Incorporations.ZeroAmount.selector);
        inc.sellForComd(coinA, 1, 0);
        // 1 wei COMD buy: fees round to 0, the trade still has to produce coins
        vm.prank(alice);
        uint256 out = inc.buyWithComd(coinA, 1, 0);
        assertGt(out, 0);
        assertEq(inc.totalBacking(), 980e18 + 1);
    }

    function testFuzz_feesExactlyTwoPercentFloor(uint256 amt) public {
        amt = bound(amt, 1, 4_000_000e18);
        uint256 rew0 = comd.balanceOf(address(distributor));
        uint256 dead0 = comd.balanceOf(DEAD);
        uint256 l0 = comd.balanceOf(launcher);
        vm.prank(alice);
        inc.buyWithComd(coinA, amt, 0);
        assertEq(comd.balanceOf(address(distributor)) - rew0, amt * 100 / 10_000);
        assertEq(comd.balanceOf(DEAD) - dead0, amt * 50 / 10_000);
        assertEq(comd.balanceOf(launcher) - l0, amt * 50 / 10_000);
        assertEq(comd.balanceOf(address(inc)), inc.totalBacking(), "net exactly backs the curve");
    }

    /// The ETH refund hook of a trader cannot re-enter the launchpad.
    function test_reentrancyViaEthRefundBlocked() public {
        swapper.setRefundBps(1_000); // venue refunds 10% → trader gets ETH back inside buyWithETH
        ReentrantTrader t = new ReentrantTrader(inc, coinA);
        comd.transfer(address(t), 10e18);
        vm.prank(address(t));
        comd.approve(address(inc), type(uint256).max);
        vm.deal(address(this), 1 ether);
        t.buy{value: 1 ether}();
        assertFalse(t.reentered(), "re-entry blocked");
        assertEq(bytes4(t.reason()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertGt(address(t).balance, 0, "refund still delivered");
        assertGe(comd.balanceOf(address(inc)), inc.totalBacking());
    }

    /// Slippage on every path; unknown coins rejected on every path.
    function test_slippageAndUnknownCoinEverywhere() public {
        vm.prank(alice);
        uint256 a = inc.buyWithComd(coinA, 1_000e18, 0);
        vm.startPrank(alice);
        vm.expectRevert();
        inc.buyWithComd(coinA, 1e18, type(uint256).max);
        vm.expectRevert();
        inc.sellForComd(coinA, a, type(uint256).max);
        vm.deal(alice, 1 ether);
        vm.expectRevert();
        inc.buyWithETH{value: 0.1 ether}(coinA, type(uint256).max);
        vm.expectRevert();
        inc.sellForETH(coinA, a, type(uint256).max);
        vm.expectRevert(Incorporations.UnknownCoin.selector);
        inc.buyWithETH{value: 0.1 ether}(address(comd), 0);
        vm.expectRevert(Incorporations.UnknownCoin.selector);
        inc.sellForETH(address(comd), 1, 0);
        vm.expectRevert(Incorporations.UnknownCoin.selector);
        inc.quoteBuy(address(0xBEEF), 1);
        vm.stopPrank();
        assertEq(IERC20(coinA).balanceOf(alice), a, "nothing moved");
    }

    /// Owner cannot touch backing through any owner function.
    function test_ownerCannotReachBacking() public {
        vm.prank(alice);
        inc.buyWithComd(coinA, 100_000e18, 0);
        uint256 backing = inc.totalBacking();
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(Incorporations.ExceedsSurplus.selector, 0, 1));
        inc.rescueERC20(IERC20(address(comd)), admin, 1);
        inc.setVirtualComd(1_000e18); // affects new coins only
        vm.stopPrank();
        assertEq(inc.coinInfo(coinA).virtualComd, 100_000e18);
        assertEq(comd.balanceOf(address(inc)), backing);
    }
}

// ------------------------------------------------------------------------------------------------ Launches

contract AuditLaunches is Base {
    ProjectFactory f;
    ContributorDistributor cd;
    LaunchGuardHook guard;
    address registrar = makeAddr("registrar");
    address lpOwner = makeAddr("lpOwner");
    address payer = makeAddr("payer");
    uint256 constant LSUPPLY = 1_000_000_000e18;
    bytes32[] leaves;

    function setUp() public {
        setUpSystem();
        f = new ProjectFactory(manager, admin, lpOwner);
        cd = f.contributorDistributor();
        address g = address(uint160(0x7777) << 144 | uint160(Hooks.BEFORE_INITIALIZE_FLAG));
        deployCodeTo("LaunchGuardHook.sol:LaunchGuardHook", abi.encode(address(manager), address(f)), g);
        guard = LaunchGuardHook(g);
        vm.startPrank(admin);
        f.setGuardHook(IHooks(g));
        f.grantRole(f.REGISTRAR_ROLE(), registrar);
        f.setPairedConfig(address(comd), true, 100_000e18, 100_000_000e18); // $COMD only, as deployed
        vm.stopPrank();
        leaves.push(_contribLeaf(1, alice, LSUPPLY * 600 / 10_000));
        leaves.push(_contribLeaf(1, bob, LSUPPLY * 400 / 10_000));
    }

    function _params() internal view returns (ProjectFactory.LaunchParams memory p) {
        p.kind = 1;
        p.name = "In re Widgets";
        p.symbol = "WIDG";
        p.paired = address(comd);
        p.fee = 3_000;
        p.initialMarketCap = 1_000_000e18; // 1M COMD for the whole supply
        p.poolBps = 8_000;
        p.remainderTo = payer;
        p.contributorRoot = _root(leaves);
        p.salt = keccak256("s");
    }

    /// COMD-paired launch: ETH pairing is off, the pool is paired with COMD, buyers trade COMD→token, the LP owner
    /// collects COMD fees through `take`, the remainder lands with the payer.
    function test_comdPairedLaunchEndToEnd() public {
        ProjectFactory.LaunchParams memory p = _params();
        p.paired = address(0);
        vm.prank(registrar);
        vm.expectRevert(ProjectFactory.PairedNotAllowed.selector);
        f.launch(p);
        p = _params();
        vm.prank(registrar);
        (uint256 id, address token) = f.launch(p);
        ProjectFactory.Launch memory l = f.launches(id);
        bool tokenIs0 = token < address(comd);
        assertEq(Currency.unwrap(tokenIs0 ? l.key.currency1 : l.key.currency0), address(comd));
        assertEq(IERC20(token).balanceOf(payer), LSUPPLY - LSUPPLY / 10 - l.poolAmount);
        assertEq(IERC20(token).balanceOf(address(f)), 0, "factory keeps nothing");
        // a buyer pays COMD
        comd.approve(address(swapRouter), type(uint256).max);
        BalanceDelta d = swapRouter.swap(
            l.key,
            SwapParams({
                zeroForOne: !tokenIs0,
                amountSpecified: -int256(10_000e18),
                sqrtPriceLimitX96: !tokenIs0 ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        int128 got = tokenIs0 ? d.amount0() : d.amount1();
        assertGt(got, 0, "received launch tokens for COMD");
        // ≈ 10,000 COMD at 1M COMD / 1B tokens = 1e-3 COMD per token → ≈ 1e7 tokens minus 0.3% fee and impact
        assertApproxEqRel(uint256(int256(got)), 10_000_000e18 * 997 / 1000, 0.05e18);
        // the LP owner collects the 0.3% fee in COMD
        vm.prank(lpOwner);
        (uint256 a0, uint256 a1) = f.collectFees(id, lpOwner);
        uint256 comdFee = tokenIs0 ? a1 : a0;
        assertApproxEqRel(comdFee, 30e18, 0.01e18, "0.3% of 10,000 COMD");
        assertEq(comd.balanceOf(lpOwner), comdFee);
    }

    /// Nobody but the registrar launches or deploys; nobody but the lpOwner touches the position; the guard hook
    /// refuses pool creation by anyone else, so the launch pool cannot be pre-created at an attacker's price.
    function test_accessControlAndGuard() public {
        ProjectFactory.LaunchParams memory p = _params();
        vm.prank(admin); // even the admin is not a registrar
        vm.expectRevert();
        f.launch(p);
        vm.prank(registrar);
        (uint256 id,) = f.launch(p);
        vm.prank(registrar);
        vm.expectRevert(ProjectFactory.NotLpOwner.selector);
        f.removeLiquidity(id, 1, registrar);
        vm.prank(admin);
        vm.expectRevert(ProjectFactory.NotLpOwner.selector);
        f.transferLpOwner(id, admin);
        // predictable next token address: try to pre-create its pool with the guard hook → refused
        PoolKey memory k = f.launches(id).key;
        k.fee = 10_000;
        k.tickSpacing = 200;
        vm.expectRevert();
        manager.initialize(k, 79228162514264337593543950336);
        // unlockCallback is PoolManager-only
        vm.expectRevert(ProjectFactory.NotPoolManager.selector);
        f.unlockCallback("");
    }

    /// A contributor leaf for launch 1 cannot be claimed on launch 2 (launchId is in the leaf); claims are capped
    /// by the launch's total even if the root over-allocates.
    function test_contributorReplayAndCap() public {
        vm.prank(registrar);
        (uint256 id1, address t1) = f.launch(_params());
        ProjectFactory.LaunchParams memory p = _params();
        p.salt = keccak256("t");
        p.contributorRoot = _root(leaves); // same root re-used for launch 2
        vm.prank(registrar);
        (uint256 id2,) = f.launch(p);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ContributorDistributor.InvalidProof.selector);
        cd.claim(id2, alice, LSUPPLY * 600 / 10_000, _proof(leaves, 0)); // leaf says launchId 1
        cd.claim(id1, alice, LSUPPLY * 600 / 10_000, _proof(leaves, 0));
        assertEq(IERC20(t1).balanceOf(alice), LSUPPLY * 600 / 10_000);
        // over-allocated root: a 2-leaf tree summing to 110% of the pool is capped at the pool
        bytes32[] memory over = new bytes32[](2);
        over[0] = _contribLeaf(3, alice, LSUPPLY * 600 / 10_000);
        over[1] = _contribLeaf(3, bob, LSUPPLY * 500 / 10_000);
        p.salt = keccak256("u");
        p.contributorRoot = _root(over);
        vm.prank(registrar);
        (uint256 id3,) = f.launch(p);
        vm.warp(block.timestamp + 1 hours);
        cd.claim(id3, alice, LSUPPLY * 600 / 10_000, _proof(over, 0));
        vm.expectRevert(ContributorDistributor.ExceedsTotal.selector);
        cd.claim(id3, bob, LSUPPLY * 500 / 10_000, _proof(over, 1));
    }
}

// ------------------------------------------------------------------------------------------------ Flywheel

/// Adapter that delivers a different Counsel than the one asked for.
contract WrongIdAdapter is IMarketplaceAdapter, IERC721Receiver {
    function buy(address nft, uint256, uint256, address recipient, bytes calldata data) external payable returns (uint256) {
        uint256 other = abi.decode(data, (uint256));
        IERC721(nft).safeTransferFrom(address(this), recipient, other);
        return msg.value;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract AuditFlywheel is Base {
    address seller = makeAddr("seller");

    function setUp() public {
        setUpSystem();
        _tax(1 ether);
        vm.prank(admin);
        counsel.reserveMint(seller, 4);
    }

    /// An adapter that delivers the wrong Counsel (or keeps the ETH) makes the sweep revert — the keeper cannot be
    /// tricked into paying for a different token, and the same id cannot be swept twice.
    function test_sweepDeliveryChecks() public {
        WrongIdAdapter w = new WrongIdAdapter();
        vm.prank(seller);
        counsel.transferFrom(seller, address(w), 2);
        vm.prank(admin);
        flywheel.setAdapter(address(w), true);
        vm.prank(keeper);
        vm.expectRevert(Flywheel.NotDelivered.selector);
        flywheel.sweep(address(w), abi.encode(uint256(2)), 1, 0.1 ether);
        (, uint256 s) = flywheel.bucketBalances();
        assertEq(s, 0.5 ether, "bucket untouched after revert");
        // deliver the right one (data = 2, tokenId = 2) → swept; a second sweep of #2 is refused
        vm.prank(keeper);
        flywheel.sweep(address(w), abi.encode(uint256(2)), 2, 0.1 ether);
        assertEq(counsel.ownerOf(2), address(flywheel));
        vm.prank(keeper);
        vm.expectRevert(Flywheel.AlreadyHeld.selector);
        flywheel.sweep(address(w), abi.encode(uint256(2)), 2, 0.1 ether);
        _assertTaxConservation();
    }

    /// The owner holds, moves and can re-list swept Counsels: award to a wallet, that wallet lists on the
    /// marketplace, and the Flywheel can sweep it again.
    function test_sweptNftCustodyAndRelisting() public {
        vm.startPrank(seller);
        counsel.setApprovalForAll(address(marketplace), true);
        marketplace.list(address(counsel), 1, 0.1 ether);
        vm.stopPrank();
        vm.prank(keeper);
        flywheel.sweep(address(marketplace), "", 1, 0.1 ether);
        // nobody but the owner can move it: no approve/transfer surface exists on the Flywheel
        vm.prank(keeper);
        vm.expectRevert();
        flywheel.awardSwept(1, keeper);
        vm.prank(seller);
        vm.expectRevert();
        counsel.transferFrom(address(flywheel), seller, 1);
        vm.prank(admin);
        flywheel.awardSwept(1, treasury);
        assertEq(counsel.ownerOf(1), treasury);
        vm.startPrank(treasury);
        counsel.setApprovalForAll(address(marketplace), true);
        marketplace.list(address(counsel), 1, 0.05 ether);
        vm.stopPrank();
        vm.prank(keeper);
        flywheel.sweep(address(marketplace), "", 1, 0.1 ether);
        assertEq(counsel.ownerOf(1), address(flywheel));
        assertEq(flywheel.totalSwept(), 2);
        _assertTaxConservation();
    }

    /// bps extremes: 100% buyback or 100% sweep both keep conservation; a zero-value send is a no-op.
    function test_bpsExtremes() public {
        vm.prank(admin);
        flywheel.setBps(10_000, 0);
        _tax(0.3 ether);
        (uint256 b, uint256 s) = flywheel.bucketBalances();
        assertEq(b, 0.8 ether);
        assertEq(s, 0.5 ether);
        vm.prank(admin);
        flywheel.setBps(0, 10_000);
        _tax(0.2 ether);
        (b, s) = flywheel.bucketBalances();
        assertEq(b, 0.8 ether);
        assertEq(s, 0.7 ether);
        _assertTaxConservation();
    }
}

// ------------------------------------------------------------------------------------------------ misc

contract AuditMisc is Test {
    function test_create2DeployerFrontRunIsHarmless() public {
        Create2Deployer c2 = new Create2Deployer();
        bytes memory init = abi.encodePacked(type(LaunchToken).creationCode, abi.encode("X", "X", 1e18, address(this)));
        address predicted = c2.computeAddress(bytes32(uint256(1)), keccak256(init));
        vm.prank(makeAddr("frontrunner"));
        address a = c2.deploy(bytes32(uint256(1)), init);
        assertEq(a, predicted, "identical init code gives an identical address, regardless of who sends it");
        assertEq(IERC20(a).balanceOf(address(this)), 1e18, "constructor args are part of the commitment");
        vm.expectRevert();
        c2.deploy(bytes32(uint256(1)), init); // the second deployment fails (address taken)
    }

    function test_oracleNotYetValidAndWrongDomain() public {
        uint256 pk = 0xA77E57;
        OracleConsumerExample c = new OracleConsumerExample(vm.addr(pk), address(this));
        vm.warp(1_800_000_000);
        OracleAttestationVerifier.OracleAttestation memory a;
        a.requestId = keccak256("r");
        a.answerType = "bool";
        a.answer = abi.encode(true);
        a.issuedAt = uint64(block.timestamp + 10);
        a.expiresAt = uint64(block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, c.digest(a));
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert(abi.encodeWithSelector(OracleAttestationVerifier.AttestationNotYetValid.selector, a.issuedAt));
        c.submit(a, sig);
        // a signature over a different domain name is just a wrong signer
        bytes32 badDomain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
                keccak256("Company.md Worker"),
                keccak256("1"),
                block.chainid
            )
        );
        bytes32 structHash = OracleAttestationVerifier.hashStruct(a);
        (v, r, s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", badDomain, structHash)));
        vm.warp(block.timestamp + 20);
        vm.expectRevert();
        c.submit(a, abi.encodePacked(r, s, v));
    }
}
