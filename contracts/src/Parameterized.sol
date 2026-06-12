// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title Parameterized — time-locked protocol parameter governance (HARD §15.2
///        "Upgradeability must be governed and time-locked")
/// @notice Economic constants are UNFROZEN protocol parameters (ADR-003/007/008):
///         they are stored here, changed only via schedule→apply with a delay,
///         and every change emits events for the public dashboard.
abstract contract Parameterized is StepManaged {
    struct PendingParam {
        uint256 value;
        uint64 eta;
        bool exists;
    }

    /// @notice Seconds between scheduling and applying a parameter change.
    uint64 public immutable PARAM_DELAY;

    mapping(bytes32 => uint256) internal _params;
    mapping(bytes32 => PendingParam) public pendingParams;

    event ParamScheduled(bytes32 indexed key, uint256 value, uint64 eta);
    event ParamApplied(bytes32 indexed key, uint256 value);
    event ParamCancelled(bytes32 indexed key);

    error UnknownParam(bytes32 key);
    error NothingPending(bytes32 key);
    error TimelockNotElapsed(bytes32 key, uint64 eta);
    error InvalidParamValue(bytes32 key, uint256 value);

    constructor(StepAccess access_, uint64 paramDelay_) StepManaged(access_) {
        PARAM_DELAY = paramDelay_;
    }

    function getParam(bytes32 key) public view returns (uint256) {
        if (!_isKnownParam(key)) revert UnknownParam(key);
        return _params[key];
    }

    function scheduleParam(bytes32 key, uint256 value)
        external
        onlyStepRole(ACCESS.PARAM_ROLE())
    {
        if (!_isKnownParam(key)) revert UnknownParam(key);
        _validateParam(key, value);
        uint64 eta = uint64(block.timestamp) + PARAM_DELAY;
        pendingParams[key] = PendingParam({value: value, eta: eta, exists: true});
        emit ParamScheduled(key, value, eta);
    }

    /// @notice Anyone may apply a matured change — the timelock, not the caller,
    ///         is the control.
    function applyParam(bytes32 key) external {
        PendingParam memory p = pendingParams[key];
        if (!p.exists) revert NothingPending(key);
        if (block.timestamp < p.eta) revert TimelockNotElapsed(key, p.eta);
        // Re-validate at apply time: cross-parameter constraints may have changed.
        _validateParam(key, p.value);
        _params[key] = p.value;
        delete pendingParams[key];
        emit ParamApplied(key, p.value);
    }

    function cancelParam(bytes32 key) external onlyStepRole(ACCESS.PARAM_ROLE()) {
        if (!pendingParams[key].exists) revert NothingPending(key);
        delete pendingParams[key];
        emit ParamCancelled(key);
    }

    /// @dev Constructor-only initialisation, bypasses the timelock once.
    function _initParam(bytes32 key, uint256 value) internal {
        _validateParam(key, value);
        _params[key] = value;
        emit ParamApplied(key, value);
    }

    function _isKnownParam(bytes32 key) internal view virtual returns (bool);

    /// @dev Revert with InvalidParamValue on out-of-range values.
    function _validateParam(bytes32 key, uint256 value) internal view virtual;
}
