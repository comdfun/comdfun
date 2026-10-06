// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMarketplaceAdapter} from "../interfaces/IMarketplaceAdapter.sol";

/// @title SeaportAdapter — SKELETON IMarketplaceAdapter for Seaport-style marketplaces
/// @notice UNAUDITED — experimental and NOT tested against a real Seaport deployment (none is confirmed on
///         Robinhood Chain). Interface-level only: `data` must be the FULL calldata of a Seaport fulfillment
///         (fulfillBasicOrder / fulfillBasicOrder_efficient_6GL6yc / fulfillOrder / fulfillAdvancedOrder) built
///         off-chain from the marketplace's order API, with this adapter as fulfiller/recipient. Every
///         marketplace (OpenSea, Magic Eden, …) needs its own order-building code off-chain.
/// @notice Flow: forward `maxPrice` ETH with `data` to `seaport`; require the adapter now owns `tokenId`; send it
///         to `recipient`; refund all remaining ETH to the caller. Holds nothing between calls. The owner (Admin,
///         Ownable2Step) can only recover stranded ETH / tokens / NFTs (V7 safety net); it has no say in buys.
contract SeaportAdapter is IMarketplaceAdapter, IERC721Receiver, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable seaport;

    event Rescued(address indexed asset, address indexed to, uint256 amountOrId);

    bytes4 public constant FULFILL_BASIC_ORDER = 0xfb0f3ee1;
    bytes4 public constant FULFILL_BASIC_ORDER_EFFICIENT = 0x00000000;
    bytes4 public constant FULFILL_ORDER = 0xb3a34c4c;
    bytes4 public constant FULFILL_ADVANCED_ORDER = 0xe7acab24;

    error SelectorNotAllowed(bytes4 selector);
    error MarketplaceCallFailed(bytes reason);
    error NotDelivered();
    error TransferFailed();
    error ZeroAddress();

    constructor(address seaport_, address owner_) Ownable(owner_) {
        if (seaport_ == address(0)) revert ZeroAddress();
        seaport = seaport_;
    }

    receive() external payable {}

    function buy(address nft, uint256 tokenId, uint256 maxPrice, address recipient, bytes calldata data)
        external
        payable
        nonReentrant
        returns (uint256 spent)
    {
        bytes4 sel = data.length >= 4 ? bytes4(data[:4]) : bytes4(0xffffffff);
        if (
            sel != FULFILL_BASIC_ORDER && sel != FULFILL_BASIC_ORDER_EFFICIENT && sel != FULFILL_ORDER
                && sel != FULFILL_ADVANCED_ORDER
        ) revert SelectorNotAllowed(sel);
        uint256 before = address(this).balance - msg.value;
        (bool ok, bytes memory ret) = seaport.call{value: maxPrice}(data);
        if (!ok) revert MarketplaceCallFailed(ret);
        if (IERC721(nft).ownerOf(tokenId) != address(this)) revert NotDelivered();
        IERC721(nft).safeTransferFrom(address(this), recipient, tokenId);
        uint256 left = address(this).balance - before;
        spent = msg.value - left;
        if (left > 0) {
            (bool r,) = msg.sender.call{value: left}("");
            if (!r) revert TransferFailed();
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ------------------------------------------------------------ safety nets (owner)

    function rescueETH(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Rescued(address(0), to, amount);
    }

    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }

    /// @notice An NFT a marketplace delivered to the adapter outside a `buy` (or a buy that reverted after delivery
    ///         cannot happen: delivery is checked in the same call) can be forwarded to its rightful holder.
    function rescueERC721(IERC721 nft, uint256 tokenId, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        nft.transferFrom(address(this), to, tokenId);
        emit Rescued(address(nft), to, tokenId);
    }
}
