// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title SafetyRegistry — blocked/restricted triangles and emergency freezes
///        (SC-002, SAF-002/003/004)
/// @notice STEP must never incentivise entering unsafe or restricted locations
///         (HARD §14.1). Freezes are immediate, reason-coded, and publicly
///         logged; claims against frozen triangles revert in the verifier.
contract SafetyRegistry is StepManaged {
    struct Freeze {
        bool frozen;
        bytes32 reasonCode;
        uint64 frozenAt;
    }

    mapping(bytes32 => Freeze) private _freezes;

    event TriangleFrozen(bytes32 indexed triangleId, bytes32 reasonCode);
    event TriangleUnfrozen(bytes32 indexed triangleId);

    constructor(StepAccess access_) StepManaged(access_) {}

    function freezeTriangle(bytes32 triangleId, bytes32 reasonCode)
        external
        onlyStepRole(ACCESS.SAFETY_ROLE())
    {
        _freezes[triangleId] =
            Freeze({frozen: true, reasonCode: reasonCode, frozenAt: uint64(block.timestamp)});
        emit TriangleFrozen(triangleId, reasonCode);
    }

    function unfreezeTriangle(bytes32 triangleId) external onlyStepRole(ACCESS.SAFETY_ROLE()) {
        delete _freezes[triangleId];
        emit TriangleUnfrozen(triangleId);
    }

    function isTriangleBlocked(bytes32 triangleId) external view returns (bool) {
        return _freezes[triangleId].frozen;
    }

    function getRestrictionReason(bytes32 triangleId) external view returns (bytes32) {
        return _freezes[triangleId].reasonCode;
    }
}
