// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title ProofRegistry — on-chain commitments to off-chain evidence (SC-002)
/// @notice Stores ONLY hashes: the claim hash and the hash of the encrypted
///         evidence bundle's CID (POP-008/PRV-001 — raw GPS never on-chain).
contract ProofRegistry is StepManaged {
    struct ProofRef {
        bytes32 triangleId;
        bytes32 proofCidHash;
        uint64 storedAt;
    }

    mapping(bytes32 => ProofRef) public proofs;

    event ProofStored(bytes32 indexed claimHash, bytes32 indexed triangleId, bytes32 proofCidHash);

    error ProofAlreadyStored(bytes32 claimHash);

    constructor(StepAccess access_) StepManaged(access_) {}

    function store(bytes32 claimHash, bytes32 triangleId, bytes32 proofCidHash)
        external
        onlyStepRole(ACCESS.VERIFIER_ROLE())
    {
        if (proofs[claimHash].storedAt != 0) revert ProofAlreadyStored(claimHash);
        proofs[claimHash] = ProofRef({
            triangleId: triangleId,
            proofCidHash: proofCidHash,
            storedAt: uint64(block.timestamp)
        });
        emit ProofStored(claimHash, triangleId, proofCidHash);
    }

    function hasProof(bytes32 claimHash) external view returns (bool) {
        return proofs[claimHash].storedAt != 0;
    }
}
