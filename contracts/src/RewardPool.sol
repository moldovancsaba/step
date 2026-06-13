// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";
import {TrinityToken} from "./TrinityToken.sol";
import {CampaignRegistry} from "./CampaignRegistry.sol";

/// @title RewardPool — sponsored Trinity escrow (SC-002, TOK-003)
/// @notice Holds campaign-locked Trinity. Sponsored Trinity is always
///         pre-existing Trinity transferred in (never minted — HARD §4.6
///         scarcity rule). Releases happen only through the verifier on
///         accepted proof; refunds only through the registry's policy.
contract RewardPool is StepManaged {
    TrinityToken public immutable TOKEN;
    CampaignRegistry public immutable REGISTRY;

    event SponsoredRewardReleased(
        bytes32 indexed campaignId, address indexed miner, uint256 trinityAmount
    );
    event CampaignRefunded(bytes32 indexed campaignId, address indexed to, uint256 amount);

    constructor(StepAccess access_, TrinityToken token_, CampaignRegistry registry_)
        StepManaged(access_)
    {
        TOKEN = token_;
        REGISTRY = registry_;
    }

    /// @notice Merchant funds a campaign (pre-funding, OAS-005). Requires prior
    ///         ERC-20 approval to this pool.
    function fund(bytes32 campaignId, uint256 amount)
        external
        whenDomainNotPaused(ACCESS.PAUSE_CAMPAIGNS())
    {
        require(TOKEN.transferFrom(msg.sender, address(this), amount), "RewardPool: transfer");
        REGISTRY.onFunded(campaignId, msg.sender, amount);
    }

    /// @notice Verifier-only release on accepted sponsored proof.
    function release(bytes32 campaignId, bytes32 triangleId, address miner)
        external
        onlyStepRole(ACCESS.VERIFIER_ROLE())
        whenDomainNotPaused(ACCESS.PAUSE_CAMPAIGNS())
        returns (uint256 amount)
    {
        amount = REGISTRY.onSponsoredClaim(campaignId, triangleId, miner);
        require(TOKEN.transfer(miner, amount), "RewardPool: transfer");
        emit SponsoredRewardReleased(campaignId, miner, amount);
    }

    /// @notice Settle remaining funds of a terminal campaign per its policy.
    function refund(bytes32 campaignId) external {
        (address to, uint256 amount) = REGISTRY.onRefund(campaignId);
        require(TOKEN.transfer(to, amount), "RewardPool: transfer");
        emit CampaignRefunded(campaignId, to, amount);
    }
}
