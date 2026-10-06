// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC8004Identity, IERC8004Reputation} from "../src/interfaces/IERC8004.sol";
import {CounselNFT} from "../src/CounselNFT.sol";
import {ERC8004Fixture} from "./utils/ERC8004Fixture.sol";

/// @notice A Counsel holder registers their seat as an ERC-8004 agent; the platform (a different wallet)
///         records accepted work as reputation feedback.
contract ERC8004Test is ERC8004Fixture {
    IERC8004Identity identity;
    IERC8004Reputation reputation;
    CounselNFT counsel;
    address admin = makeAddr("admin");
    address holder = makeAddr("holder");
    address platform = makeAddr("platform");

    function setUp() public {
        (identity, reputation) = deployErc8004(admin);
        counsel = new CounselNFT(admin, admin, "https://api.example/agents/by-token/");
        vm.prank(admin);
        counsel.reserveMint(holder, 42);
    }

    function test_registerCounselAgentAndGiveFeedback() public {
        string memory uri = counsel.tokenURI(42);
        assertEq(uri, "https://api.example/agents/by-token/42.json");

        vm.prank(holder);
        uint256 agentId = identity.register(uri);
        assertEq(agentId, 0, "ids start at 0");
        assertEq(identity.ownerOf(agentId), holder);
        assertEq(identity.tokenURI(agentId), uri);
        assertEq(identity.getAgentWallet(agentId), holder);
        assertEq(identity.getVersion(), "2.0.0");

        // holder cannot rate their own agent
        vm.prank(holder);
        vm.expectRevert(bytes("Self-feedback not allowed"));
        reputation.giveFeedback(agentId, 100, 0, "job", "accepted", "", "", bytes32(0));

        vm.prank(platform);
        reputation.giveFeedback(
            agentId, 95, 0, "job", "accepted", "", "https://api.example/reviews/0xabc.json", keccak256("review")
        );
        (int128 v, uint8 dec, string memory t1, string memory t2, bool revoked) =
            reputation.readFeedback(agentId, platform, 1);
        assertEq(v, 95);
        assertEq(dec, 0);
        assertEq(t1, "job");
        assertEq(t2, "accepted");
        assertFalse(revoked);
        address[] memory clients = new address[](1);
        clients[0] = platform;
        (uint64 count, int128 sum,) = reputation.getSummary(agentId, clients, "", "");
        assertEq(count, 1);
        assertEq(sum, 95);
    }

    function test_onlyOwnerUpgrades() public {
        address impl = deployCode("IdentityRegistryUpgradeable.sol:IdentityRegistryUpgradeable");
        vm.prank(holder);
        vm.expectRevert();
        identity.upgradeToAndCall(impl, "");
        assertEq(identity.owner(), admin);
    }
}
