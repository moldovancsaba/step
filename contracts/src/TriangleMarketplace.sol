// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title TriangleMarketplace — list/buy/cancel/gift triangle slot NFTs (issue #8)
/// @notice Approval-based escrow: the seller keeps the NFT until sale and approves
///         this contract; `buy` performs an atomic Trinity↔NFT swap. Value-agnostic
///         and TESTNET-FIRST — priced in Trinity (a valueless testnet unit). A
///         real-money path is gated behind legal/audit (see legal-risk register) and
///         is intentionally absent. Pausable via PAUSE_MARKET.
/// @dev    Checks-effects-interactions + ReentrancyGuard; stale-listing guard re-checks
///         live ownership at buy time. No protocol fee in the testnet phase.
contract TriangleMarketplace is StepManaged, ReentrancyGuard {
    IERC721 public immutable NFT;
    IERC20 public immutable TRINITY;

    struct Listing {
        address seller;
        uint256 priceTrinity;
        bool active;
    }

    mapping(uint256 => Listing) public listings; // tokenId -> listing

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 priceTrinity);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(
        uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 priceTrinity
    );
    event Gifted(uint256 indexed tokenId, address indexed from, address indexed to);

    error NotTokenOwner(uint256 tokenId, address caller);
    error PriceTooLow(uint256 price);
    error NotListed(uint256 tokenId);
    error NotSeller(uint256 tokenId, address caller);
    error SellerNoLongerOwns(uint256 tokenId);
    error SelfBuy(uint256 tokenId);

    constructor(StepAccess access_, IERC721 nft_, IERC20 trinity_) StepManaged(access_) {
        NFT = nft_;
        TRINITY = trinity_;
    }

    /// @notice List a slot NFT for a Trinity price. Caller must own it and approve
    ///         this contract (operator or per-token) so `buy` can transfer it.
    function list(uint256 tokenId, uint256 priceTrinity) external {
        if (NFT.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (priceTrinity < 1) revert PriceTooLow(priceTrinity); // Trinity is indivisible
        listings[tokenId] = Listing({seller: msg.sender, priceTrinity: priceTrinity, active: true});
        emit Listed(tokenId, msg.sender, priceTrinity);
    }

    /// @notice Cancel your listing. Allowed even while the market is paused (so users
    ///         can always withdraw).
    function cancel(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (!l.active) revert NotListed(tokenId);
        if (l.seller != msg.sender) revert NotSeller(tokenId, msg.sender);
        delete listings[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    /// @notice Buy a listed NFT: atomic Trinity→seller, NFT→buyer. Requires buyer
    ///         Trinity allowance and seller NFT approval to this contract.
    function buy(uint256 tokenId)
        external
        nonReentrant
        whenDomainNotPaused(ACCESS.PAUSE_MARKET())
    {
        Listing memory l = listings[tokenId];
        if (!l.active) revert NotListed(tokenId);
        if (NFT.ownerOf(tokenId) != l.seller) revert SellerNoLongerOwns(tokenId); // stale guard
        if (msg.sender == l.seller) revert SelfBuy(tokenId);
        delete listings[tokenId]; // effects before interactions
        require(TRINITY.transferFrom(msg.sender, l.seller, l.priceTrinity), "Marketplace: pay failed");
        NFT.safeTransferFrom(l.seller, msg.sender, tokenId);
        emit Sold(tokenId, l.seller, msg.sender, l.priceTrinity);
    }

    /// @notice Give an NFT away (free transfer); clears any active listing.
    function gift(uint256 tokenId, address to) external {
        if (NFT.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (listings[tokenId].active) {
            delete listings[tokenId];
            emit Cancelled(tokenId, msg.sender);
        }
        NFT.safeTransferFrom(msg.sender, to, tokenId);
        emit Gifted(tokenId, msg.sender, to);
    }

    function listingOf(uint256 tokenId) external view returns (Listing memory) {
        return listings[tokenId];
    }
}
