// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title CounselNFT — "Counsel" (COUNSEL), UUPS upgradeable
/// @notice Reviewed before launch: an internal security review plus an independent security review (contracts/AUDIT.md).
/// @notice 2,000 seats. Each Counsel is a seat at the bar: its holder registers it as an ERC-8004 agent.
///         Phases: 0 closed, 1 allowlist (Merkle), 2 public. Price in ETH (default 0) and max per wallet
///         (default 2) are set by the owner. `mintedBy` counts allowlist + public mints of a wallet.
///         The owner may reserve-mint any part of the remaining supply (not counted in `mintedBy`).
///         ERC-2981: 5% royalty to the treasury. Mint proceeds are withdrawn to the treasury.
/// @notice **Upgradeable (V7 safety net).** Deployed behind an ERC1967 proxy; the owner (Admin) and only the owner
///         can `upgradeToAndCall` to a new implementation (`_authorizeUpgrade` is `onlyOwner`). The implementation
///         contract itself is locked with `_disableInitializers()` and `initialize` runs once, atomically in the
///         proxy constructor. Holders, balances, approvals, phase, price, baseURI and the owner all live in the
///         proxy's storage and survive upgrades.
/// @dev Storage layout (all ERC-7201 namespaced, so a V2 can add state without collisions):
///      - `openzeppelin.storage.ERC721`, `openzeppelin.storage.ERC2981`, `openzeppelin.storage.Ownable`,
///        `openzeppelin.storage.Ownable2Step`, `openzeppelin.storage.Initializable` (OpenZeppelin upgradeable bases),
///      - `comd.storage.CounselNFT` (this contract: treasury, phase, price, maxPerWallet, allowlistRoot, totalSupply,
///        mintedBy, baseURI, metadataFrozen) at slot
///        keccak256(abi.encode(uint256(keccak256("comd.storage.CounselNFT")) - 1)) & ~bytes32(uint256(0xff)).
///      A V2 implementation MUST keep `CounselStorage`'s existing fields in order and append new ones at the end.
///      Token ids are 1..2000. tokenURI = baseURI + id + ".json" (e.g. https://api.comd.fun/agents/by-token/42.json).
///      Allowlist leaf = keccak256(bytes.concat(keccak256(abi.encode(account)))).
contract CounselNFT is
    Initializable,
    ERC721Upgradeable,
    ERC2981Upgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    using Strings for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant MAX_SUPPLY = 2000;
    uint96 public constant ROYALTY_BPS = 500; // 5%
    uint256 public constant MAX_PER_WALLET_LIMIT = 100;

    uint8 public constant PHASE_CLOSED = 0;
    uint8 public constant PHASE_ALLOWLIST = 1;
    uint8 public constant PHASE_PUBLIC = 2;

    /// @custom:storage-location erc7201:comd.storage.CounselNFT
    struct CounselStorage {
        address treasury;
        uint8 phase;
        uint256 price;
        uint256 maxPerWallet;
        bytes32 allowlistRoot;
        uint256 totalSupply;
        mapping(address => uint256) mintedBy;
        string baseTokenURI;
        bool metadataFrozen;
    }

    // keccak256(abi.encode(uint256(keccak256("comd.storage.CounselNFT")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant COUNSEL_STORAGE_LOCATION =
        0x7f20e33c2300d142d730871216527226b063fb87db091baafa9245b9b1f65400;

    function _s() private pure returns (CounselStorage storage $) {
        assembly {
            $.slot := COUNSEL_STORAGE_LOCATION
        }
    }

    event PhaseSet(uint8 phase);
    event PriceSet(uint256 price);
    event MaxPerWalletSet(uint256 maxPerWallet);
    event AllowlistRootSet(bytes32 root);
    event BaseURISet(string baseURI);
    event MetadataFrozen();
    event TreasurySet(address treasury);
    event Withdrawn(address indexed to, uint256 amount);
    event Rescued(address indexed token, address indexed to, uint256 amount);
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
    error RenounceDisabled();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Runs once, in the proxy constructor. `royaltyReceiver` is the treasury (royalties + mint proceeds).
    function initialize(address initialOwner, string calldata baseURI_, address royaltyReceiver) external initializer {
        if (initialOwner == address(0) || royaltyReceiver == address(0)) revert ZeroAddress();
        __ERC721_init("Counsel", "COUNSEL");
        __ERC2981_init();
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __UUPSUpgradeable_init();
        CounselStorage storage $ = _s();
        $.treasury = royaltyReceiver;
        $.baseTokenURI = baseURI_;
        $.maxPerWallet = 2;
        _setDefaultRoyalty(royaltyReceiver, ROYALTY_BPS);
    }

    /// @dev Only the owner (Admin) may upgrade the proxy to a new implementation.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Disabled: an ownerless UUPS proxy could never be upgraded or administered again. Ownership moves
    ///         only with the two-step transfer; to freeze the collection for good, upgrade to an implementation
    ///         whose `_authorizeUpgrade` always reverts.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ----------------------------------------------------------------- minting

    /// @notice Public-phase mint.
    function mint(uint256 quantity) external payable {
        if (_s().phase != PHASE_PUBLIC) revert MintClosed();
        _paidMint(quantity);
    }

    /// @notice Allowlist-phase mint (also accepted during the public phase with a valid proof).
    function allowlistMint(uint256 quantity, bytes32[] calldata proof) external payable {
        CounselStorage storage $ = _s();
        if ($.phase == PHASE_CLOSED) revert MintClosed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verifyCalldata(proof, $.allowlistRoot, leaf)) revert InvalidProof();
        _paidMint(quantity);
    }

    function _paidMint(uint256 quantity) private {
        CounselStorage storage $ = _s();
        if (quantity == 0) revert ZeroQuantity();
        if ($.mintedBy[msg.sender] + quantity > $.maxPerWallet) revert WalletLimit();
        if (msg.value != $.price * quantity) revert WrongPayment();
        $.mintedBy[msg.sender] += quantity;
        _mintMany(msg.sender, quantity);
    }

    /// @notice Owner mint from the remaining supply (founding partners, bounties, partners).
    function reserveMint(address to, uint256 quantity) external onlyOwner {
        if (quantity == 0) revert ZeroQuantity();
        _mintMany(to, quantity);
    }

    function _mintMany(address to, uint256 quantity) private {
        CounselStorage storage $ = _s();
        uint256 next = $.totalSupply;
        if (next + quantity > MAX_SUPPLY) revert SoldOut();
        $.totalSupply = next + quantity;
        for (uint256 i = 1; i <= quantity; ++i) {
            _safeMint(to, next + i);
        }
    }

    /// @notice Permissionless: sends the mint proceeds to the treasury.
    function withdraw() external {
        address t = _s().treasury;
        uint256 bal = address(this).balance;
        (bool ok,) = t.call{value: bal}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(t, bal);
    }

    // ------------------------------------------------------------- admin (owner)

    function setPhase(uint8 newPhase) external onlyOwner {
        if (newPhase > PHASE_PUBLIC) revert BadPhase();
        _s().phase = newPhase;
        emit PhaseSet(newPhase);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        _s().price = newPrice;
        emit PriceSet(newPrice);
    }

    function setMaxPerWallet(uint256 newMax) external onlyOwner {
        if (newMax == 0 || newMax > MAX_PER_WALLET_LIMIT) revert BadLimit();
        _s().maxPerWallet = newMax;
        emit MaxPerWalletSet(newMax);
    }

    function setAllowlistRoot(bytes32 root) external onlyOwner {
        _s().allowlistRoot = root;
        emit AllowlistRootSet(root);
    }

    /// @notice Treasury receives royalties and mint proceeds.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        _s().treasury = newTreasury;
        _setDefaultRoyalty(newTreasury, ROYALTY_BPS);
        emit TreasurySet(newTreasury);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        CounselStorage storage $ = _s();
        if ($.metadataFrozen) revert Frozen();
        $.baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
        if ($.totalSupply > 0) emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Irreversibly freezes the base URI (for this implementation; an upgrade can still fix a broken URI).
    function freezeMetadata() external onlyOwner {
        _s().metadataFrozen = true;
        emit MetadataFrozen();
    }

    /// @notice Recover ERC-20 tokens sent here by mistake (the contract never holds tokens by design).
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Rescued(address(token), to, amount);
    }

    /// @notice Recover an NFT of another collection pushed here with an unsafe transfer (Counsel itself cannot be
    ///         held by this contract: `_safeMint` and marketplaces never deliver to the collection address).
    function rescueERC721(IERC721 nft, uint256 tokenId, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        nft.transferFrom(address(this), to, tokenId);
        emit Rescued(address(nft), to, tokenId);
    }

    // ------------------------------------------------------------------- views

    function treasury() external view returns (address) {
        return _s().treasury;
    }

    function phase() external view returns (uint8) {
        return _s().phase;
    }

    function price() external view returns (uint256) {
        return _s().price;
    }

    function maxPerWallet() external view returns (uint256) {
        return _s().maxPerWallet;
    }

    function allowlistRoot() external view returns (bytes32) {
        return _s().allowlistRoot;
    }

    function totalSupply() external view returns (uint256) {
        return _s().totalSupply;
    }

    /// @notice Alias of `totalSupply` (ids are never burned, so minted == supply).
    function totalMinted() external view returns (uint256) {
        return _s().totalSupply;
    }

    function mintedBy(address account) external view returns (uint256) {
        return _s().mintedBy[account];
    }

    function metadataFrozen() external view returns (bool) {
        return _s().metadataFrozen;
    }

    function baseURI() external view returns (string memory) {
        return _s().baseTokenURI;
    }

    /// @notice Collection-level metadata (ERC-7572 / OpenSea `contractURI`): baseURI + "collection.json".
    function contractURI() external view returns (string memory) {
        return string.concat(_s().baseTokenURI, "collection.json");
    }

    /// @notice The current implementation behind the proxy (ERC-1967 slot).
    function implementation() external view returns (address) {
        return ERC1967Utils.getImplementation();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_s().baseTokenURI, tokenId.toString(), ".json");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Upgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId);
    }
}
