// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title StepGovToken — governance voting power for the STEP DAO (#55).
/// @notice A dedicated, checkpointed `ERC20Votes` token whose balances/delegated
///         votes weight on-chain governance (`StepGovernor`). It is SEPARATE from
///         `TrinityToken` (the indivisible mining accounting unit): governance
///         power must not be conflated with mining rewards, and repurposing the
///         decimals-0 accounting unit for vote checkpointing would be wrong.
/// @dev    Voting uses the default block-number clock. Holders must `delegate`
///         (to themselves or another address) for their balance to count as votes
///         — standard OZ Governor semantics. Minting is `GOV_ROLE`-gated so the
///         DAO/admin controls the voter set; in the north-star end-state this maps
///         to validator weight.
contract StepGovToken is ERC20, ERC20Permit, ERC20Votes, StepManaged {
    constructor(StepAccess access_)
        ERC20("STEP Governance", "STEP-GOV")
        ERC20Permit("STEP Governance")
        StepManaged(access_)
    {}

    /// @notice Mint governance power. Restricted to `GOV_ROLE` (the admin/DAO).
    function mint(address to, uint256 amount) external onlyStepRole(ACCESS.GOV_ROLE()) {
        _mint(to, amount);
    }

    // --- required multiple-inheritance overrides (OZ v5) ---

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
