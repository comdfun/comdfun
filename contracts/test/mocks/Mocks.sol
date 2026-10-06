// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IMarketplaceAdapter} from "../../src/interfaces/IMarketplaceAdapter.sol";

/// @notice Plain mintable ERC-20 for tests.
contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Not a Counsel: used to check the Flywheel only accepts Company.md Counsel.
contract OtherNFT is ERC721 {
    constructor() ERC721("Other", "OTH") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// @notice Adapter that takes the ETH and delivers nothing.
contract RugAdapter is IMarketplaceAdapter {
    function buy(address, uint256, uint256, address, bytes calldata) external payable returns (uint256) {
        return msg.value;
    }
}

/// @notice Adapter that holds a Counsel, tries to re-enter the Flywheel during a sweep, then delivers it for free
///         (refunding all ETH) so the outer sweep succeeds and the re-entry result can be inspected.
contract ReentrantAdapter is IMarketplaceAdapter {
    address public target;
    bytes public payload;
    bool public reentered;
    bytes public reason;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function buy(address nft, uint256 tokenId, uint256, address recipient, bytes calldata)
        external
        payable
        returns (uint256)
    {
        (bool ok, bytes memory r) = target.call(payload);
        reentered = ok;
        reason = r;
        IERC721(nft).safeTransferFrom(address(this), recipient, tokenId);
        (bool s,) = msg.sender.call{value: msg.value}("");
        require(s, "refund");
        return 0;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @notice Minimal Seaport stand-in: any allowed-selector call transfers a pre-approved NFT to msg.sender for
///         `price` and refunds the rest.
contract MockSeaport {
    IERC721 public nft;
    address public seller;
    uint256 public tokenId;
    uint256 public price;

    function setOrder(IERC721 nft_, address seller_, uint256 tokenId_, uint256 price_) external {
        (nft, seller, tokenId, price) = (nft_, seller_, tokenId_, price_);
    }

    receive() external payable {
        revert("no plain ETH");
    }

    fallback() external payable {
        require(msg.value >= price, "underpaid");
        nft.transferFrom(seller, msg.sender, tokenId);
        (bool ok,) = seller.call{value: price}("");
        require(ok, "pay");
        if (msg.value > price) {
            (ok,) = msg.sender.call{value: msg.value - price}("");
            require(ok, "refund");
        }
    }
}
