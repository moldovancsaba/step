// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title TrinityToken — Trinity accounting (SC-002, SYS §13.3)
/// @notice Trinity is the smallest indivisible unit of STEP (PRD-004/005).
///         `decimals() == 0`: every on-chain amount is an integer count of
///         Trinity, so sub-Trinity amounts are unrepresentable by construction
///         (HARD §4.3). UI layers may display 1 STEP = `trinity_per_step`
///         Trinity (UNFROZEN parameter, OPEN-1) — that ratio never appears here.
/// @dev    Minting is restricted to MINTER_ROLE, held only by the
///         MiningClaimVerifier and FoundationTreasury contract addresses.
///         Natural supply rule (TOK-002): those are the only mint paths, and
///         both are claim-driven.
contract TrinityToken is ERC20, StepManaged {
    constructor(StepAccess access_) ERC20("STEP Trinity", "TRIN") StepManaged(access_) {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount)
        external
        onlyStepRole(ACCESS.MINTER_ROLE())
        whenDomainNotPaused(ACCESS.PAUSE_MINTING())
    {
        require(amount >= 1, "Trinity: mint below 1");
        _mint(to, amount);
    }
}
