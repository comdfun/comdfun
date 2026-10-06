// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IMarketplaceAdapter} from "../../src/interfaces/IMarketplaceAdapter.sol";
import {IBuybackSwapper} from "../../src/interfaces/IBuybackSwapper.sol";

/// @notice Plain mintable ERC-20 for tests.
contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Fixed-rate ETH <-> COMD venue standing in for the Pons pool: `rate` COMD wei per 1 ETH wei (1e18 scale).
///         Holds its own COMD and ETH inventory (fund it in the test). Optional `refundBps` returns part of the ETH
///         unused (partial-fill simulation); optional `ethTaxBps` simulates a hook taking ETH off the top.
contract MockSwapper is IBuybackSwapper {
    IERC20 public immutable comd;
    uint256 public rate; // COMD per ETH, 18-decimal scaled: out = ethIn * rate / 1e18
    uint16 public refundBps;
    uint16 public ethTaxBps;
    uint256 public taxed;

    error Expired();
    error Slippage(uint256 out, uint256 minOut);

    constructor(IERC20 comd_, uint256 rate_) {
        comd = comd_;
        rate = rate_;
    }

    receive() external payable {}

    function setRate(uint256 r) external {
        rate = r;
    }

    function setRefundBps(uint16 b) external {
        refundBps = b;
    }

    function setEthTaxBps(uint16 b) external {
        ethTaxBps = b;
    }

    function quoteETHForComd(uint256 ethIn) public view returns (uint256) {
        uint256 used = ethIn - (ethIn * refundBps) / 10_000;
        used -= (used * ethTaxBps) / 10_000;
        return (used * rate) / 1e18;
    }

    function quoteComdForETH(uint256 amountIn) public view returns (uint256) {
        uint256 eth = (amountIn * 1e18) / rate;
        return eth - (eth * ethTaxBps) / 10_000;
    }

    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline)
        external
        payable
        returns (uint256 out)
    {
        if (block.timestamp > deadline) revert Expired();
        uint256 refund = (msg.value * refundBps) / 10_000;
        taxed += ((msg.value - refund) * ethTaxBps) / 10_000;
        out = quoteETHForComd(msg.value);
        if (out < minOut) revert Slippage(out, minOut);
        require(comd.transfer(to, out), "inventory");
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "refund");
        }
    }

    function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external
        returns (uint256 out)
    {
        if (block.timestamp > deadline) revert Expired();
        require(comd.transferFrom(msg.sender, address(this), amountIn), "pull");
        out = quoteComdForETH(amountIn);
        taxed += (amountIn * 1e18) / rate - out;
        if (out < minOut) revert Slippage(out, minOut);
        (bool ok,) = to.call{value: out}("");
        require(ok, "eth");
    }
}

/// @notice Swapper that takes the ETH and delivers nothing (a broken or malicious venue).
contract RugSwapper is IBuybackSwapper {
    receive() external payable {}

    function swapExactETHForComd(uint256, address, uint256) external payable returns (uint256) {
        return 1; // lies about the output
    }

    function swapExactComdForETH(uint256, uint256, address, uint256) external pure returns (uint256) {
        return 0;
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

/// @notice Swapper that tries to re-enter the Flywheel during a buyback, then delivers COMD normally.
contract ReentrantSwapper is IBuybackSwapper {
    IERC20 public immutable comd;
    address public target;
    bytes public payload;
    bool public reentered;
    bytes public reason;

    constructor(IERC20 comd_) {
        comd = comd_;
    }

    receive() external payable {}

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function swapExactETHForComd(uint256, address to, uint256) external payable returns (uint256 out) {
        (bool ok, bytes memory r) = target.call(payload);
        reentered = ok;
        reason = r;
        out = msg.value * 1e8;
        require(comd.transfer(to, out), "inventory");
    }

    function swapExactComdForETH(uint256, uint256, address, uint256) external pure returns (uint256) {
        return 0;
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
