// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TrinityToken} from "../src/TrinityToken.sol";
import {TriangleSlotNFT} from "../src/TriangleSlotNFT.sol";
import {TriangleMarketplace} from "../src/TriangleMarketplace.sol";

contract TriangleMarketplaceTest is Test {
    StepAccess internal access;
    TrinityToken internal trinity;
    TriangleSlotNFT internal nft;
    TriangleMarketplace internal market;

    address internal admin = makeAddr("admin");
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal recipient = makeAddr("recipient");
    address internal verifier = makeAddr("verifier"); // NFT minter stand-in
    address internal minter = makeAddr("minter"); // Trinity minter stand-in

    bytes32 internal constant TRI = keccak256("STEP-21-F00-12203302320201032103");
    uint256 internal tokenId;

    function setUp() public {
        access = new StepAccess(admin);
        trinity = new TrinityToken(access);
        nft = new TriangleSlotNFT(access);
        market = new TriangleMarketplace(access, nft, trinity);

        bytes32 nftMinter = access.NFT_MINTER_ROLE();
        bytes32 tokMinter = access.MINTER_ROLE();
        bytes32 pauser = access.PAUSER_ROLE();
        vm.startPrank(admin);
        access.grantRole(nftMinter, verifier);
        access.grantRole(tokMinter, minter);
        access.grantRole(pauser, admin);
        vm.stopPrank();

        // Mint a slot NFT to the seller; fund the buyer with Trinity.
        vm.prank(verifier);
        tokenId = nft.mintSlot(seller, TRI, 21, 0, uint64(block.timestamp));
        vm.prank(minter);
        trinity.mint(buyer, 1_000_000);

        // Seller approves the marketplace to move the NFT (approval-based escrow).
        vm.prank(seller);
        nft.setApprovalForAll(address(market), true);
        // Buyer approves Trinity spend.
        vm.prank(buyer);
        trinity.approve(address(market), type(uint256).max);
    }

    function _list(uint256 price) internal {
        vm.prank(seller);
        market.list(tokenId, price);
    }

    function test_list_buy_atomic_swap() public {
        _list(100_000);
        uint256 sellerBefore = trinity.balanceOf(seller);
        vm.prank(buyer);
        market.buy(tokenId);
        assertEq(nft.ownerOf(tokenId), buyer, "nft to buyer");
        assertEq(trinity.balanceOf(seller), sellerBefore + 100_000, "trinity to seller");
        assertEq(trinity.balanceOf(buyer), 1_000_000 - 100_000, "buyer debited");
        assertFalse(market.listingOf(tokenId).active, "listing cleared");
    }

    function test_cancel() public {
        _list(100_000);
        vm.prank(seller);
        market.cancel(tokenId);
        assertFalse(market.listingOf(tokenId).active);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TriangleMarketplace.NotListed.selector, tokenId));
        market.buy(tokenId);
    }

    function test_gift_transfers_and_clears_listing() public {
        _list(100_000);
        vm.prank(seller);
        market.gift(tokenId, recipient);
        assertEq(nft.ownerOf(tokenId), recipient);
        assertFalse(market.listingOf(tokenId).active);
    }

    function test_only_owner_can_list() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TriangleMarketplace.NotTokenOwner.selector, tokenId, buyer));
        market.list(tokenId, 100_000);
    }

    function test_price_must_be_at_least_one() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(TriangleMarketplace.PriceTooLow.selector, uint256(0)));
        market.list(tokenId, 0);
    }

    function test_self_buy_reverts() public {
        _list(100_000);
        // give seller Trinity + approval so only the self-buy guard triggers
        vm.prank(minter);
        trinity.mint(seller, 200_000);
        vm.prank(seller);
        trinity.approve(address(market), type(uint256).max);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(TriangleMarketplace.SelfBuy.selector, tokenId));
        market.buy(tokenId);
    }

    function test_stale_listing_reverts_after_owner_moves() public {
        _list(100_000);
        // Seller gifts the NFT elsewhere directly (bypassing the listing).
        vm.prank(seller);
        nft.transferFrom(seller, recipient, tokenId);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TriangleMarketplace.SellerNoLongerOwns.selector, tokenId));
        market.buy(tokenId);
    }

    function test_pause_blocks_buy_but_not_cancel() public {
        _list(100_000);
        bytes32 dom = access.PAUSE_MARKET();
        vm.prank(admin);
        access.setPaused(dom, true);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(StepAccess.DomainIsPaused.selector, dom));
        market.buy(tokenId);
        // cancel still works while paused
        vm.prank(seller);
        market.cancel(tokenId);
        assertFalse(market.listingOf(tokenId).active);
    }

    function test_relist_updates_price() public {
        _list(100_000);
        _list(250_000);
        assertEq(market.listingOf(tokenId).priceTrinity, 250_000);
        uint256 sellerBefore = trinity.balanceOf(seller);
        vm.prank(buyer);
        market.buy(tokenId);
        assertEq(trinity.balanceOf(seller), sellerBefore + 250_000);
    }
}
