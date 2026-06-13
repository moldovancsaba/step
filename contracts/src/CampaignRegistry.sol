// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title CampaignRegistry — merchant campaigns and Trinity oases (SC-002,
///        MER-002/003, OAS-004/005)
/// @notice Campaign state machine per DEV §15.2. Funds are escrowed in the
///         separate RewardPool; this contract is the single source of campaign
///         truth. Settlement rules (OAS-005): pre-funded before activation,
///         release only on accepted proof, rejected claims never charge the
///         merchant (no release without verifier call), expiry + predefined
///         refund policy.
contract CampaignRegistry is StepManaged {
    enum CampaignStatus {
        None,
        PendingReview,
        Approved,
        Funded,
        Active,
        Paused,
        Completed,
        Rejected,
        Expired,
        Cancelled
    }

    enum RefundPolicy {
        ReturnToMerchant,
        ToTreasury
    }

    struct Campaign {
        address merchant;
        uint256 rewardPerClaim;
        uint256 budget;
        uint256 released;
        uint256 refunded;
        uint64 startsAt;
        uint64 endsAt;
        uint32 maxClaimsPerWallet;
        uint8 requiredProofLevel; // 1..5 = L1..L5 (POP-004)
        RefundPolicy refundPolicy;
        CampaignStatus status;
    }

    address public rewardPool;
    address public treasury;
    uint256 private _nonce;

    mapping(bytes32 => Campaign) public campaigns;
    mapping(bytes32 => mapping(bytes32 => bool)) public campaignTriangle;
    mapping(bytes32 => mapping(address => uint32)) public claimsByWallet;

    event CampaignCreated(bytes32 indexed campaignId, address indexed merchant, bytes32[] triangleIds);
    event CampaignStatusChanged(bytes32 indexed campaignId, uint8 status);
    event OasisFunded(bytes32 indexed campaignId, uint256 trinityAmount, uint256 newBudget);
    event SponsoredClaimRecorded(bytes32 indexed campaignId, address indexed miner, uint256 trinityAmount);
    event CampaignRefundRecorded(bytes32 indexed campaignId, address to, uint256 amount);

    error NotRewardPool();
    error BadStatus(bytes32 campaignId, CampaignStatus actual);
    error NotMerchantOf(bytes32 campaignId);
    error OutsideWindow(bytes32 campaignId);
    error TriangleNotInCampaign(bytes32 campaignId, bytes32 triangleId);
    error WalletLimitReached(bytes32 campaignId, address miner);
    error BudgetExhausted(bytes32 campaignId);

    modifier onlyPool() {
        if (msg.sender != rewardPool) revert NotRewardPool();
        _;
    }

    constructor(StepAccess access_, address treasury_) StepManaged(access_) {
        treasury = treasury_;
    }

    /// @dev One-time wiring by admin at deployment.
    function setRewardPool(address pool) external onlyStepRole(ACCESS.DEFAULT_ADMIN_ROLE()) {
        require(rewardPool == address(0), "CampaignRegistry: pool set");
        require(pool != address(0), "CampaignRegistry: zero pool");
        rewardPool = pool;
    }

    /// @notice Merchant creates a campaign → PendingReview (admin-approved
    ///         onboarding in alpha, MER-001). Drafts live off-chain.
    function createCampaign(
        bytes32[] calldata triangleIds,
        uint256 rewardPerClaim,
        uint64 startsAt,
        uint64 endsAt,
        uint32 maxClaimsPerWallet,
        uint8 requiredProofLevel,
        RefundPolicy refundPolicy
    ) external onlyStepRole(ACCESS.MERCHANT_ROLE()) returns (bytes32 campaignId) {
        require(triangleIds.length > 0, "Campaign: no triangles");
        require(rewardPerClaim >= 1, "Campaign: sub-Trinity reward");
        require(endsAt > startsAt && endsAt > block.timestamp, "Campaign: bad window");
        require(maxClaimsPerWallet >= 1, "Campaign: zero wallet limit");
        require(requiredProofLevel >= 1 && requiredProofLevel <= 5, "Campaign: bad proof level");

        campaignId = keccak256(abi.encode(msg.sender, ++_nonce, block.chainid));
        campaigns[campaignId] = Campaign({
            merchant: msg.sender,
            rewardPerClaim: rewardPerClaim,
            budget: 0,
            released: 0,
            refunded: 0,
            startsAt: startsAt,
            endsAt: endsAt,
            maxClaimsPerWallet: maxClaimsPerWallet,
            requiredProofLevel: requiredProofLevel,
            refundPolicy: refundPolicy,
            status: CampaignStatus.PendingReview
        });
        for (uint256 i = 0; i < triangleIds.length; i++) {
            campaignTriangle[campaignId][triangleIds[i]] = true;
        }
        emit CampaignCreated(campaignId, msg.sender, triangleIds);
        emit CampaignStatusChanged(campaignId, uint8(CampaignStatus.PendingReview));
    }

    function reviewCampaign(bytes32 campaignId, bool approve)
        external
        onlyStepRole(ACCESS.CAMPAIGN_MODERATOR_ROLE())
    {
        Campaign storage c = campaigns[campaignId];
        if (c.status != CampaignStatus.PendingReview) revert BadStatus(campaignId, c.status);
        c.status = approve ? CampaignStatus.Approved : CampaignStatus.Rejected;
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    /// @dev Called by RewardPool after escrowing funds (pre-funding rule).
    function onFunded(bytes32 campaignId, address from, uint256 amount) external onlyPool {
        Campaign storage c = campaigns[campaignId];
        if (c.status != CampaignStatus.Approved && c.status != CampaignStatus.Funded) {
            revert BadStatus(campaignId, c.status);
        }
        if (from != c.merchant) revert NotMerchantOf(campaignId);
        require(amount >= c.rewardPerClaim, "Campaign: fund below one reward");
        c.budget += amount;
        c.status = CampaignStatus.Funded;
        emit OasisFunded(campaignId, amount, c.budget);
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    /// @notice Activation requires funding (OAS-005 pre-funded rule).
    function activateCampaign(bytes32 campaignId)
        external
        whenDomainNotPaused(ACCESS.PAUSE_CAMPAIGNS())
    {
        Campaign storage c = campaigns[campaignId];
        bool authorised = msg.sender == c.merchant
            || ACCESS.hasRole(ACCESS.CAMPAIGN_MODERATOR_ROLE(), msg.sender);
        require(authorised, "Campaign: not authorised");
        if (c.status != CampaignStatus.Funded) revert BadStatus(campaignId, c.status);
        if (block.timestamp >= c.endsAt) revert OutsideWindow(campaignId);
        c.status = CampaignStatus.Active;
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    function pauseCampaign(bytes32 campaignId, bool paused)
        external
        onlyStepRole(ACCESS.CAMPAIGN_MODERATOR_ROLE())
    {
        Campaign storage c = campaigns[campaignId];
        if (paused) {
            if (c.status != CampaignStatus.Active) revert BadStatus(campaignId, c.status);
            c.status = CampaignStatus.Paused;
        } else {
            if (c.status != CampaignStatus.Paused) revert BadStatus(campaignId, c.status);
            c.status = CampaignStatus.Active;
        }
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    /// @notice Merchant may cancel before activation; moderator may cancel any
    ///         non-terminal campaign (fraud/legal, HARD §11.4).
    function cancelCampaign(bytes32 campaignId) external {
        Campaign storage c = campaigns[campaignId];
        bool isModerator = ACCESS.hasRole(ACCESS.CAMPAIGN_MODERATOR_ROLE(), msg.sender);
        bool isMerchantPreActive = msg.sender == c.merchant
            && (c.status == CampaignStatus.PendingReview || c.status == CampaignStatus.Approved
                || c.status == CampaignStatus.Funded);
        require(isModerator || isMerchantPreActive, "Campaign: not authorised");
        require(
            c.status != CampaignStatus.None && c.status != CampaignStatus.Completed
                && c.status != CampaignStatus.Expired && c.status != CampaignStatus.Cancelled,
            "Campaign: terminal"
        );
        c.status = CampaignStatus.Cancelled;
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    /// @notice Anyone may expire a campaign past its end time (OAS-005 expiry).
    function expireCampaign(bytes32 campaignId) external {
        Campaign storage c = campaigns[campaignId];
        if (
            c.status != CampaignStatus.Funded && c.status != CampaignStatus.Active
                && c.status != CampaignStatus.Paused
        ) revert BadStatus(campaignId, c.status);
        require(block.timestamp >= c.endsAt, "Campaign: not ended");
        c.status = CampaignStatus.Expired;
        emit CampaignStatusChanged(campaignId, uint8(c.status));
    }

    /// @dev Called by RewardPool inside verifier-driven release. Enforces every
    ///      sponsored-claim business rule, then records the release.
    function onSponsoredClaim(bytes32 campaignId, bytes32 triangleId, address miner)
        external
        onlyPool
        returns (uint256 reward)
    {
        Campaign storage c = campaigns[campaignId];
        if (c.status != CampaignStatus.Active) revert BadStatus(campaignId, c.status);
        if (block.timestamp < c.startsAt || block.timestamp >= c.endsAt) {
            revert OutsideWindow(campaignId);
        }
        if (!campaignTriangle[campaignId][triangleId]) {
            revert TriangleNotInCampaign(campaignId, triangleId);
        }
        if (claimsByWallet[campaignId][miner] >= c.maxClaimsPerWallet) {
            revert WalletLimitReached(campaignId, miner);
        }
        reward = c.rewardPerClaim;
        if (c.budget - c.released < reward) revert BudgetExhausted(campaignId);
        c.released += reward;
        claimsByWallet[campaignId][miner] += 1;
        if (c.budget - c.released < reward) {
            // Pool can no longer pay another claim: oasis is Empty (HARD §10.3);
            // remaining dust follows the refund policy at expiry.
            c.status = CampaignStatus.Completed;
            emit CampaignStatusChanged(campaignId, uint8(c.status));
        }
        emit SponsoredClaimRecorded(campaignId, miner, reward);
    }

    /// @dev Called by RewardPool to settle remaining funds per refund policy
    ///      (OAS-005 "unused funds" rule). Only terminal states settle.
    function onRefund(bytes32 campaignId) external onlyPool returns (address to, uint256 amount) {
        Campaign storage c = campaigns[campaignId];
        require(
            c.status == CampaignStatus.Expired || c.status == CampaignStatus.Cancelled
                || c.status == CampaignStatus.Rejected || c.status == CampaignStatus.Completed,
            "Campaign: not settleable"
        );
        amount = c.budget - c.released - c.refunded;
        require(amount > 0, "Campaign: nothing to refund");
        c.refunded += amount;
        to = c.refundPolicy == RefundPolicy.ReturnToMerchant ? c.merchant : treasury;
        emit CampaignRefundRecorded(campaignId, to, amount);
    }

    function getCampaign(bytes32 campaignId) external view returns (Campaign memory) {
        return campaigns[campaignId];
    }
}
