// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title MeshRegistry — canonical MESH version and mineable levels (SC-002)
/// @notice Commits the active mesh specification version and the set of levels
///         that issue natural Trinity (ADR-003: alpha default [21], UNFROZEN).
///         Triangle identity on-chain is `keccak256(utf8(triangleIdString))`
///         where the string follows step-mesh-v1 (docs/geography).
contract MeshRegistry is StepManaged {
    string public meshSpecVersion;
    mapping(uint8 => bool) public mineableLevel;

    event MeshSpecVersionSet(string version);
    event MineableLevelSet(uint8 indexed level, bool mineable);

    constructor(StepAccess access_, string memory specVersion, uint8[] memory levels)
        StepManaged(access_)
    {
        meshSpecVersion = specVersion;
        emit MeshSpecVersionSet(specVersion);
        for (uint256 i = 0; i < levels.length; i++) {
            mineableLevel[levels[i]] = true;
            emit MineableLevelSet(levels[i], true);
        }
    }

    function setMeshSpecVersion(string calldata version)
        external
        onlyStepRole(ACCESS.MESH_ADMIN_ROLE())
    {
        meshSpecVersion = version;
        emit MeshSpecVersionSet(version);
    }

    function setMineableLevel(uint8 level, bool mineable)
        external
        onlyStepRole(ACCESS.MESH_ADMIN_ROLE())
    {
        mineableLevel[level] = mineable;
        emit MineableLevelSet(level, mineable);
    }

    function isMineableLevel(uint8 level) external view returns (bool) {
        return mineableLevel[level];
    }
}
