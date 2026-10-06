// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Reviewed before launch (contracts/AUDIT.md).
/// @notice Buys one ERC-721 from an NFT marketplace for the Flywheel's floor sweep.
///         The adapter receives up to `maxPrice` ETH (msg.value), must deliver `tokenId` of `nft` to `recipient`,
///         must refund every unused wei to msg.sender before returning, and returns the ETH actually spent.
///         `data` is marketplace-specific order calldata (e.g. a Seaport fulfillment) built off-chain.
interface IMarketplaceAdapter {
    function buy(address nft, uint256 tokenId, uint256 maxPrice, address recipient, bytes calldata data)
        external
        payable
        returns (uint256 spent);
}
