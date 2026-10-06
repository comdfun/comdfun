// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CounselNFT — "Company.md Counsel" (COUNSEL)
/// @notice UNAUDITED — experimental. Do not use with funds you cannot afford to lose.
/// @notice 2,000 seats. Each Counsel is a seat at the bar: its holder registers it as an ERC-8004 agent.
///         Phases: 0 closed, 1 allowlist (Merkle), 2 public. Price in ETH (default 0) and max per wallet
///         (default 2) are set by the owner. `mintedBy` counts allowlist + public mints of a wallet.
///         The owner may reserve-mint any part of the remaining supply (not counted in `mintedBy`).
///         ERC-2981: 5% royalty to the treasury. Mint proceeds are withdrawn to the treasury.
/// @dev Token ids are 1..2000. tokenURI = baseURI + id + ".json" (e.g. https://api.comd.fun/agents/by-token/42.json).
///      Allowlist leaf = keccak256(bytes.concat(keccak256(abi.encode(account)))).
contract CounselNFT is ERC721, ERC2981, Ownable2Step {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 2000;
    uint96 public constant ROYALTY_BPS = 500; // 5%
    uint256 public constant MAX_PER_WALLET_LIMIT = 100;

    uint8 public constant PHASE_CLOSED = 0;
    uint8 public constant PHASE_ALLOWLIST = 1;
    uint8 public constant PHASE_PUBLIC = 2;

    address public treasury;
    uint8 public phase;
    uint256 public price;
    uint256 public maxPerWallet = 2;
    bytes32 public allowlistRoot;
    uint256 public totalSupply;
    mapping(address => uint256) public mintedBy;

    string private _baseTokenURI;
    bool public metadataFrozen;

    event PhaseSet(uint8 phase);
    event PriceSet(uint256 price);
    event MaxPerWalletSet(uint256 maxPerWallet);
    event AllowlistRootSet(bytes32 root);
    event BaseURISet(string baseURI);
    event MetadataFrozen();
    event TreasurySet(address treasury);
    event Withdrawn(address indexed to, uint256 amount);
    /// @notice ERC-4906
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    error MintClosed();
    error InvalidProof();
    error WalletLimit();
    error SoldOut();
    error WrongPayment();
    error ZeroQuantity();
    error ZeroAddress();
    error BadPhase();
    error BadLimit();
    error Frozen();
    error TransferFailed();

    constructor(address initialOwner, address treasury_, string memory baseURI_)
        ERC721("Company.md Counsel", "COUNSEL")
        Ownable(initialOwner)
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        _baseTokenURI = baseURI_;
        _setDefaultRoyalty(treasury_, ROYALTY_BPS);
    }

    // ----------------------------------------------------------------- minting

    /// @notice Public-phase mint.
    function mint(uint256 quantity) external payable {
        if (phase != PHASE_PUBLIC) revert MintClosed();
        _paidMint(quantity);
    }

    /// @notice Allowlist-phase mint (also accepted during the public phase with a valid proof).
    function allowlistMint(uint256 quantity, bytes32[] calldata proof) external payable {
        if (phase == PHASE_CLOSED) revert MintClosed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verifyCalldata(proof, allowlistRoot, leaf)) revert InvalidProof();
        _paidMint(quantity);
    }

    function _paidMint(uint256 quantity) private {
        if (quantity == 0) revert ZeroQuantity();
        if (mintedBy[msg.sender] + quantity > maxPerWallet) revert WalletLimit();
        if (msg.value != price * quantity) revert WrongPayment();
        mintedBy[msg.sender] += quantity;
        _mintMany(msg.sender, quantity);
    }

    /// @notice Owner mint from the remaining supply (founding partners, bounties, partners).
    function reserveMint(address to, uint256 quantity) external onlyOwner {
        if (quantity == 0) revert ZeroQuantity();
        _mintMany(to, quantity);
    }

    function _mintMany(address to, uint256 quantity) private {
        uint256 next = totalSupply;
        if (next + quantity > MAX_SUPPLY) revert SoldOut();
        totalSupply = next + quantity;
        for (uint256 i = 1; i <= quantity; ++i) {
            _safeMint(to, next + i);
        }
    }

    /// @notice Permissionless: sends the mint proceeds to the treasury.
    function withdraw() external {
        uint256 bal = address(this).balance;
        (bool ok,) = treasury.call{value: bal}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(treasury, bal);
    }

    // ------------------------------------------------------------- admin (owner)

    function setPhase(uint8 newPhase) external onlyOwner {
        if (newPhase > PHASE_PUBLIC) revert BadPhase();
        phase = newPhase;
        emit PhaseSet(newPhase);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        price = newPrice;
        emit PriceSet(newPrice);
    }

    function setMaxPerWallet(uint256 newMax) external onlyOwner {
        if (newMax == 0 || newMax > MAX_PER_WALLET_LIMIT) revert BadLimit();
        maxPerWallet = newMax;
        emit MaxPerWalletSet(newMax);
    }

    function setAllowlistRoot(bytes32 root) external onlyOwner {
        allowlistRoot = root;
        emit AllowlistRootSet(root);
    }

    /// @notice Treasury receives royalties and mint proceeds.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        _setDefaultRoyalty(newTreasury, ROYALTY_BPS);
        emit TreasurySet(newTreasury);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        if (metadataFrozen) revert Frozen();
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
        if (totalSupply > 0) emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Irreversibly freezes the base URI.
    function freezeMetadata() external onlyOwner {
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    // ------------------------------------------------------------------- views

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}
