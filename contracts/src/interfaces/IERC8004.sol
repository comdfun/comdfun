// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice UNAUDITED — experimental.
/// @notice Subset of the vendored CC0 ERC-8004 IdentityRegistryUpgradeable (v2.0.0) used by Company.md.
///         Agents are ERC-721 tokens ("AgentIdentity"/"AGENT"), ids start at 0, `register` mints to msg.sender.
interface IERC8004Identity {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function register() external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function setMetadata(uint256 agentId, string calldata metadataKey, bytes calldata metadataValue) external;
    function getMetadata(uint256 agentId, string calldata metadataKey) external view returns (bytes memory);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function ownerOf(uint256 agentId) external view returns (address);
    function tokenURI(uint256 agentId) external view returns (string memory);
    function name() external view returns (string memory);
    function getVersion() external pure returns (string memory);
    function initialize() external;
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
}

/// @notice Subset of the vendored CC0 ERC-8004 ReputationRegistryUpgradeable (v2.0.0).
interface IERC8004Reputation {
    function initialize(address identityRegistry) external;
    function getIdentityRegistry() external view returns (address);
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);
    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
}
