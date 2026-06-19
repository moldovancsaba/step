// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title ReleaseRegistry — on-chain authority for trust-center code/config/runtime (#34/#35)
/// @notice The single source of truth for which node-agent/validator artifacts a
///         trust center is permitted to run. Publishing is gated by RELEASE_ROLE
///         (held in production by the release timelock/multisig, #37), so no third
///         party can authorize code — this is the structural anti-injection control.
///         Agents verify the sha256 of what they run against this registry before
///         executing it; the artifact distribution channel is never trusted.
///
///         Releases are append-only and version-monotonic per platform (a published
///         hash can never be silently rewritten). Operators stage releases (canary
///         per-node), promote a fleet default, and revoke (emergency kill-switch);
///         agents resolve their effective target deterministically.
contract ReleaseRegistry is StepManaged {
    struct Release {
        uint64 version; // packed semver: (major<<32)|(minor<<16)|patch
        bytes32 binaryHash; // sha256 of the agent/validator binary
        bytes32 paramsHash; // sha256 of protocol-params.json
        bytes32 configHash; // sha256 of the canonical runtime config
        uint64 minAgentVersion; // packed semver floor an agent must already run
        address publisher;
        uint64 createdAt;
        bool revoked;
    }

    // platform (e.g. keccak256("darwin-arm64")) => published versions (ascending)
    mapping(bytes32 => uint64[]) private _versions;
    // platform => version => Release
    mapping(bytes32 => mapping(uint64 => Release)) private _release;
    // platform => promoted fleet-default version
    mapping(bytes32 => uint64) public platformTargetVersion;
    // node => pinned version (0 = follow the platform default) — canary targeting
    mapping(address => uint64) public nodeTargetVersion;

    event ReleasePublished(
        bytes32 indexed platform, uint64 indexed version, bytes32 binaryHash, address publisher
    );
    event Promoted(bytes32 indexed platform, uint64 indexed version);
    event NodeTargeted(address indexed node, uint64 indexed version);
    event Revoked(bytes32 indexed platform, uint64 indexed version);

    error NonMonotonicVersion(uint64 latest, uint64 attempted);
    error ZeroHash();
    error UnknownRelease(bytes32 platform, uint64 version);
    error AlreadyRevoked(bytes32 platform, uint64 version);

    constructor(StepAccess access_) StepManaged(access_) {}

    // ─────────────────────────────── writes (RELEASE_ROLE) ──────────────────────

    /// @notice Publish a new authorized release and promote it as the platform
    ///         default. Append-only and strictly version-monotonic per platform.
    function publishRelease(
        bytes32 platform,
        uint64 version,
        bytes32 binaryHash,
        bytes32 paramsHash,
        bytes32 configHash,
        uint64 minAgentVersion
    ) external onlyStepRole(ACCESS.RELEASE_ROLE()) {
        uint64 latest = _latestVersion(platform);
        if (version <= latest) revert NonMonotonicVersion(latest, version);
        if (binaryHash == bytes32(0) || paramsHash == bytes32(0) || configHash == bytes32(0)) {
            revert ZeroHash();
        }
        _release[platform][version] = Release({
            version: version,
            binaryHash: binaryHash,
            paramsHash: paramsHash,
            configHash: configHash,
            minAgentVersion: minAgentVersion,
            publisher: msg.sender,
            createdAt: uint64(block.timestamp),
            revoked: false
        });
        _versions[platform].push(version);
        platformTargetVersion[platform] = version;
        emit ReleasePublished(platform, version, binaryHash, msg.sender);
        emit Promoted(platform, version);
    }

    /// @notice Make an already-published, non-revoked version the fleet default.
    function promote(bytes32 platform, uint64 version)
        external
        onlyStepRole(ACCESS.RELEASE_ROLE())
    {
        Release storage r = _release[platform][version];
        if (r.version == 0) revert UnknownRelease(platform, version);
        if (r.revoked) revert AlreadyRevoked(platform, version);
        platformTargetVersion[platform] = version;
        emit Promoted(platform, version);
    }

    /// @notice Pin a single node to a version (canary) ahead of fleet promotion.
    ///         Pass version 0 to clear the pin and follow the platform default.
    function setNodeTarget(address node, uint64 version)
        external
        onlyStepRole(ACCESS.RELEASE_ROLE())
    {
        nodeTargetVersion[node] = version;
        emit NodeTargeted(node, version);
    }

    /// @notice Emergency kill-switch: mark a version bad. The fleet default (and
    ///         any node resolving to it) falls back to the highest non-revoked
    ///         version below it.
    function revoke(bytes32 platform, uint64 version)
        external
        onlyStepRole(ACCESS.RELEASE_ROLE())
    {
        Release storage r = _release[platform][version];
        if (r.version == 0) revert UnknownRelease(platform, version);
        if (r.revoked) revert AlreadyRevoked(platform, version);
        r.revoked = true;
        if (platformTargetVersion[platform] == version) {
            platformTargetVersion[platform] = _lastGood(platform, version);
        }
        emit Revoked(platform, version);
    }

    // ─────────────────────────────── reads (agents) ─────────────────────────────

    function release(bytes32 platform, uint64 version) external view returns (Release memory) {
        return _release[platform][version];
    }

    /// @notice The current fleet-default release for a platform (post-revoke aware).
    function latestActive(bytes32 platform) external view returns (Release memory) {
        return _release[platform][platformTargetVersion[platform]];
    }

    /// @notice The release a specific node should run: its pin (if set and live)
    ///         else the platform default, skipping revoked versions.
    function effectiveTarget(address node, bytes32 platform)
        external
        view
        returns (Release memory)
    {
        uint64 v = nodeTargetVersion[node];
        if (v == 0 || _release[platform][v].version == 0 || _release[platform][v].revoked) {
            v = platformTargetVersion[platform];
        }
        // resolve through any revocations
        while (v != 0 && _release[platform][v].revoked) {
            v = _lastGood(platform, v);
        }
        return _release[platform][v];
    }

    /// @notice Exact-match authorization check used by the agent before running code.
    function isAuthorized(
        bytes32 platform,
        bytes32 binaryHash,
        bytes32 paramsHash,
        bytes32 configHash
    ) external view returns (bool) {
        Release storage r = _release[platform][platformTargetVersion[platform]];
        return !r.revoked && r.version != 0 && r.binaryHash == binaryHash
            && r.paramsHash == paramsHash && r.configHash == configHash;
    }

    function versionsOf(bytes32 platform) external view returns (uint64[] memory) {
        return _versions[platform];
    }

    // ─────────────────────────────── internal ───────────────────────────────────

    function _latestVersion(bytes32 platform) internal view returns (uint64) {
        uint64[] storage vs = _versions[platform];
        uint256 n = vs.length;
        return n == 0 ? 0 : vs[n - 1];
    }

    /// @dev Highest non-revoked version strictly below `version` (0 if none).
    function _lastGood(bytes32 platform, uint64 version) internal view returns (uint64) {
        uint64[] storage vs = _versions[platform];
        for (uint256 i = vs.length; i > 0;) {
            unchecked {
                --i;
            }
            uint64 v = vs[i];
            if (v < version && !_release[platform][v].revoked) return v;
        }
        return 0;
    }
}
