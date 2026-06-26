// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepFixture} from "./StepFixture.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {MiningClaimVerifier} from "../src/MiningClaimVerifier.sol";

contract CampaignTest is StepFixture {
    uint256 internal constant REWARD = 100_000;
    uint256 internal constant BUDGET = 250_000; // pays 2 claims + 50k dust

    function _createApprovedFundedActive(CampaignRegistry.RefundPolicy policy)
        internal
        returns (bytes32 id)
    {
        // Merchant holds pre-existing Trinity (TOK-003: sponsored = existing supply).
        vm.prank(seeder);
        token.mint(merchant, BUDGET);

        bytes32[] memory tris = new bytes32[](1);
        tris[0] = TRI_A;
        vm.prank(merchant);
        id = campaigns.createCampaign(
            tris,
            REWARD,
            uint64(block.timestamp),
            uint64(block.timestamp + 7 days),
            1, // per-wallet limit (alpha default)
            4, // L4 merchant proof
            policy
        );
        vm.prank(admin);
        campaigns.reviewCampaign(id, true);
        vm.startPrank(merchant);
        token.approve(address(pool), BUDGET);
        pool.fund(id, BUDGET);
        campaigns.activateCampaign(id);
        vm.stopPrank();
    }

    function _sponsoredClaim(bytes32 id, bytes32 claimHash, address miner_) internal {
        verifier.finaliseSponsoredClaim(
            claimHash, TRI_A, id, miner_, keccak256("cid"),
            _quorumSigs(claimHash, TRI_A_STRING, miner_, 3)
        );
    }

    function test_full_oasis_lifecycle_with_merchant_refund() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ReturnToMerchant);
        assertEq(token.balanceOf(address(pool)), BUDGET, "budget escrowed");
        assertEq(token.balanceOf(merchant), 0);

        // Two miners claim; sponsored Trinity is released, never minted.
        uint256 supplyBefore = token.totalSupply();
        _sponsoredClaim(id, keccak256("sp-1"), miner);
        address miner2 = makeAddr("miner2");
        _sponsoredClaim(id, keccak256("sp-2"), miner2);
        assertEq(token.balanceOf(miner), REWARD);
        assertEq(token.balanceOf(miner2), REWARD);
        assertEq(token.totalSupply(), supplyBefore, "no mint on sponsored path");

        // Budget can no longer pay a third claim → Completed (oasis Empty).
        CampaignRegistry.Campaign memory c = campaigns.getCampaign(id);
        assertEq(uint8(c.status), uint8(CampaignRegistry.CampaignStatus.Completed));

        // Unused dust follows the refund policy.
        pool.refund(id);
        assertEq(token.balanceOf(merchant), BUDGET - 2 * REWARD, "dust refunded to merchant");

        // Double-refund impossible.
        vm.expectRevert("Campaign: nothing to refund");
        pool.refund(id);
    }

    function test_per_wallet_limit_enforced() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ReturnToMerchant);
        _sponsoredClaim(id, keccak256("wl-1"), miner);
        bytes32 ch = keccak256("wl-2");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_A_STRING, miner, 3);
        vm.expectRevert(
            abi.encodeWithSelector(CampaignRegistry.WalletLimitReached.selector, id, miner)
        );
        verifier.finaliseSponsoredClaim(ch, TRI_A, id, miner, keccak256("cid"), sigs);
    }

    function test_claim_outside_campaign_triangle_rejected() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ReturnToMerchant);
        bytes32 ch = keccak256("wrong-tri");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_B_STRING, miner, 3);
        vm.expectRevert(
            abi.encodeWithSelector(CampaignRegistry.TriangleNotInCampaign.selector, id, TRI_B)
        );
        verifier.finaliseSponsoredClaim(ch, TRI_B, id, miner, keccak256("cid"), sigs);
    }

    function test_expiry_refund_to_treasury_policy() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ToTreasury);
        _sponsoredClaim(id, keccak256("tt-1"), miner);

        vm.warp(block.timestamp + 8 days);
        campaigns.expireCampaign(id);

        uint256 before = token.balanceOf(address(treasury));
        pool.refund(id);
        assertEq(token.balanceOf(address(treasury)), before + BUDGET - REWARD);
    }

    function test_expired_campaign_rejects_claims() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ReturnToMerchant);
        vm.warp(block.timestamp + 8 days);
        campaigns.expireCampaign(id);

        bytes32 ch = keccak256("late");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_A_STRING, miner, 3);
        vm.expectRevert(); // BadStatus(Expired)
        verifier.finaliseSponsoredClaim(ch, TRI_A, id, miner, keccak256("cid"), sigs);
    }

    function test_cannot_activate_unfunded_campaign() public {
        bytes32[] memory tris = new bytes32[](1);
        tris[0] = TRI_A;
        vm.prank(merchant);
        bytes32 id = campaigns.createCampaign(
            tris, REWARD, uint64(block.timestamp), uint64(block.timestamp + 1 days), 1, 4,
            CampaignRegistry.RefundPolicy.ReturnToMerchant
        );
        vm.prank(admin);
        campaigns.reviewCampaign(id, true);

        // Pre-funding rule (OAS-005): Approved but unfunded cannot activate.
        vm.prank(merchant);
        vm.expectRevert(
            abi.encodeWithSelector(
                CampaignRegistry.BadStatus.selector, id, CampaignRegistry.CampaignStatus.Approved
            )
        );
        campaigns.activateCampaign(id);
    }

    function test_rejected_campaign_cannot_fund() public {
        bytes32[] memory tris = new bytes32[](1);
        tris[0] = TRI_A;
        vm.prank(merchant);
        bytes32 id = campaigns.createCampaign(
            tris, REWARD, uint64(block.timestamp), uint64(block.timestamp + 1 days), 1, 4,
            CampaignRegistry.RefundPolicy.ReturnToMerchant
        );
        vm.prank(admin);
        campaigns.reviewCampaign(id, false); // moderator rejects

        vm.prank(seeder);
        token.mint(merchant, BUDGET);
        vm.startPrank(merchant);
        token.approve(address(pool), BUDGET);
        vm.expectRevert(
            abi.encodeWithSelector(
                CampaignRegistry.BadStatus.selector, id, CampaignRegistry.CampaignStatus.Rejected
            )
        );
        pool.fund(id, BUDGET);
        vm.stopPrank();
    }

    function test_only_merchant_role_can_create() public {
        bytes32[] memory tris = new bytes32[](1);
        tris[0] = TRI_A;
        vm.prank(miner);
        vm.expectRevert();
        campaigns.createCampaign(
            tris, REWARD, uint64(block.timestamp), uint64(block.timestamp + 1 days), 1, 4,
            CampaignRegistry.RefundPolicy.ReturnToMerchant
        );
    }

    function test_moderator_can_pause_and_cancel_active_campaign() public {
        bytes32 id = _createApprovedFundedActive(CampaignRegistry.RefundPolicy.ReturnToMerchant);

        vm.prank(admin);
        campaigns.pauseCampaign(id, true);
        bytes32 ch = keccak256("paused-claim");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_A_STRING, miner, 3);
        vm.expectRevert();
        verifier.finaliseSponsoredClaim(ch, TRI_A, id, miner, keccak256("cid"), sigs);

        vm.prank(admin);
        campaigns.cancelCampaign(id);
        pool.refund(id);
        assertEq(token.balanceOf(merchant), BUDGET, "full refund after cancel");
    }
}
