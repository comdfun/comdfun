// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IMarketplaceAdapter} from "../interfaces/IMarketplaceAdapter.sol";

/// @title MockMarketplace — a fixed-price ERC-721 marketplace that is its own IMarketplaceAdapter
/// @notice UNAUDITED — TESTNET / TESTS ONLY. Sellers `list` (after approving this contract); `buy` pays the seller
///         the listing price, delivers the NFT to `recipient` and refunds the rest to msg.sender.
contract MockMarketplace is IMarketplaceAdapter {
    struct Listing {
        address seller;
        uint256 price;
    }

    mapping(address => mapping(uint256 => Listing)) public listings;

    event Listed(address indexed nft, uint256 indexed tokenId, address seller, uint256 price);
    event Sold(address indexed nft, uint256 indexed tokenId, address buyer, uint256 price);

    error NotOwner();
    error NotListed();
    error PriceAboveMax();
    error Underpaid();
    error TransferFailed();

    function list(address nft, uint256 tokenId, uint256 price) external {
        if (IERC721(nft).ownerOf(tokenId) != msg.sender) revert NotOwner();
        listings[nft][tokenId] = Listing(msg.sender, price);
        emit Listed(nft, tokenId, msg.sender, price);
    }

    function buy(address nft, uint256 tokenId, uint256 maxPrice, address recipient, bytes calldata)
        external
        payable
        returns (uint256 spent)
    {
        Listing memory l = listings[nft][tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.price > maxPrice) revert PriceAboveMax();
        if (msg.value < l.price) revert Underpaid();
        delete listings[nft][tokenId];
        IERC721(nft).safeTransferFrom(l.seller, recipient, tokenId);
        _send(l.seller, l.price);
        if (msg.value > l.price) _send(msg.sender, msg.value - l.price);
        emit Sold(nft, tokenId, recipient, l.price);
        return l.price;
    }

    function _send(address to, uint256 v) private {
        (bool ok,) = to.call{value: v}("");
        if (!ok) revert TransferFailed();
    }
}
