// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";
import {ValidatorRegistry} from "./ValidatorRegistry.sol";

/// @title IntegrityAttestation — on-chain tamper reporting with quorum auto-suspend (#36)
/// @notice Closes the trust loop for node self-integrity: when a trust center's
///         measured code/params/config hashes diverge from the authorized release,
///         a tamper report is recorded and the node is demoted to `UnderReview` in
///         ValidatorRegistry, dropping its quorum weight to zero until remediated
///         and cleared. Reporting is gated by INTEGRITY_ROLE (node self-report +
///         hub attestor); clearing requires VALIDATOR_ADMIN_ROLE.
///
///         This contract must hold VALIDATOR_ADMIN_ROLE so it can transition node
///         status; only the two functions below mutate status, both role-gated.
contract IntegrityAttestation is StepManaged {
    ValidatorRegistry public immutable VALIDATORS;

    struct Finding {
        bytes32 measuredBinary;
        bytes32 measuredParams;
        bytes32 measuredConfig;
        bytes32 evidenceHash; // hash of off-chain evidence (no raw data on-chain)
        uint64 at;
        address reporter;
    }

    mapping(address => Finding) public lastFinding;
    mapping(address => bool) public underIntegrityHold;

    event TamperReported(address indexed node, address indexed reporter, bytes32 evidenceHash);
    event TamperCleared(address indexed node, address indexed by);

    error NotUnderHold(address node);

    constructor(StepAccess access_, ValidatorRegistry validators_) StepManaged(access_) {
        require(address(validators_) != address(0), "IntegrityAttestation: zero registry");
        VALIDATORS = validators_;
    }

    /// @notice Record a measured-hash mismatch and demote the node from quorum.
    ///         Reverts (via ValidatorRegistry) if the node is not registered.
    function reportTamper(
        address node,
        bytes32 measuredBinary,
        bytes32 measuredParams,
        bytes32 measuredConfig,
        bytes32 evidenceHash
    ) external onlyStepRole(ACCESS.INTEGRITY_ROLE()) {
        lastFinding[node] = Finding({
            measuredBinary: measuredBinary,
            measuredParams: measuredParams,
            measuredConfig: measuredConfig,
            evidenceHash: evidenceHash,
            at: uint64(block.timestamp),
            reporter: msg.sender
        });
        underIntegrityHold[node] = true;
        VALIDATORS.setStatus(node, ValidatorRegistry.ValidatorStatus.UnderReview);
        emit TamperReported(node, msg.sender, evidenceHash);
    }

    /// @notice Restore a node to Active after remediation (privileged).
    function clearTamper(address node) external onlyStepRole(ACCESS.VALIDATOR_ADMIN_ROLE()) {
        if (!underIntegrityHold[node]) revert NotUnderHold(node);
        underIntegrityHold[node] = false;
        VALIDATORS.setStatus(node, ValidatorRegistry.ValidatorStatus.Active);
        emit TamperCleared(node, msg.sender);
    }

    function tamperState(address node) external view returns (bool held, Finding memory last) {
        return (underIntegrityHold[node], lastFinding[node]);
    }
}
