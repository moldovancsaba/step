// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess} from "./StepAccess.sol";
import {Parameterized} from "./Parameterized.sol";
import {TrinityToken} from "./TrinityToken.sol";

/// @title FoundationTreasury — twin allocation and treasury control (SC-002, TOK-005)
/// @notice Every natural mint triggers a twin allocation at `P_TWIN_BPS`
///         (UNFROZEN, ADR-008: alpha default 10000 = 100% bootstrap rate) with
///         an optional lifetime cap `P_TWIN_CAP` (0 = uncapped). The treasury
///         address is this contract — public by construction (HARD §11.3).
///         Withdrawals are role-gated and reason-coded for the public dashboard
///         (HARD §4.8 foundation sell policy: no hidden movements).
contract FoundationTreasury is Parameterized {
    bytes32 public constant P_TWIN_BPS = keccak256("treasury.twin_bps");
    bytes32 public constant P_TWIN_CAP = keccak256("treasury.twin_cap_trinity");

    TrinityToken public immutable TOKEN;

    /// @notice Lifetime twin Trinity minted to the treasury.
    uint256 public totalTwinMinted;

    event FoundationTwinAllocated(bytes32 indexed claimHash, uint256 trinityAmount);
    event TreasuryWithdrawal(address indexed to, uint256 amount, bytes32 purposeCode);

    constructor(StepAccess access_, TrinityToken token_, uint64 paramDelay_, uint256 twinBps, uint256 twinCap)
        Parameterized(access_, paramDelay_)
    {
        TOKEN = token_;
        _initParam(P_TWIN_BPS, twinBps);
        _initParam(P_TWIN_CAP, twinCap);
    }

    function _isKnownParam(bytes32 key) internal pure override returns (bool) {
        return key == P_TWIN_BPS || key == P_TWIN_CAP;
    }

    function _validateParam(bytes32 key, uint256 value) internal pure override {
        if (key == P_TWIN_BPS && value > 10_000) revert InvalidParamValue(key, value);
    }

    /// @notice Called by the verifier on every accepted natural claim (TOK-005).
    ///         Twin = minerReward × bps / 10000, floor-rounded; amounts that
    ///         floor to zero mint nothing (never sub-Trinity, PRD-004). The cap,
    ///         when set, clamps the lifetime twin total (ADR-008).
    function allocateTwin(bytes32 claimHash, uint256 minerReward)
        external
        onlyStepRole(ACCESS.VERIFIER_ROLE())
        returns (uint256 twin)
    {
        twin = (minerReward * _params[P_TWIN_BPS]) / 10_000;
        uint256 cap = _params[P_TWIN_CAP];
        if (cap != 0) {
            uint256 remaining = cap > totalTwinMinted ? cap - totalTwinMinted : 0;
            if (twin > remaining) twin = remaining;
        }
        if (twin > 0) {
            totalTwinMinted += twin;
            TOKEN.mint(address(this), twin);
        }
        emit FoundationTwinAllocated(claimHash, twin);
    }

    /// @notice Role-gated, reason-coded treasury movement (HARD §11.3:
    ///         spending categories defined and reported).
    function withdraw(address to, uint256 amount, bytes32 purposeCode)
        external
        onlyStepRole(ACCESS.TREASURER_ROLE())
    {
        require(to != address(0), "Treasury: zero recipient");
        TOKEN.transfer(to, amount);
        emit TreasuryWithdrawal(to, amount, purposeCode);
    }

    function balance() external view returns (uint256) {
        return TOKEN.balanceOf(address(this));
    }
}
