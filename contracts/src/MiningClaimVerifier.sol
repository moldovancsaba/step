// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {StepAccess} from "./StepAccess.sol";
import {Parameterized} from "./Parameterized.sol";
import {TrinityToken} from "./TrinityToken.sol";
import {MeshRegistry} from "./MeshRegistry.sol";
import {SafetyRegistry} from "./SafetyRegistry.sol";
import {ValidatorRegistry} from "./ValidatorRegistry.sol";
import {TriangleMiningState} from "./TriangleMiningState.sol";
import {FoundationTreasury} from "./FoundationTreasury.sol";
import {ProofRegistry} from "./ProofRegistry.sol";
import {RewardPool} from "./RewardPool.sol";

/// @title MiningClaimVerifier — weighted-quorum claim finalisation (SC-002)
/// @notice The chain never sees coordinates (DEV §5.1, PRV-001): miners sign the
///         full claim off-chain; validators verify geometry, attestation, and
///         fraud rules off-chain and sign EIP-712 votes over the claim hash.
///         This contract verifies the weighted validator quorum (VAL-002) and
///         finalises economic state: natural mints + twin (SYS §23.1 steps
///         11–15) or sponsored releases (SYS §23.2).
/// @dev    Replay protection: every claimHash finalises at most once, across
///         both natural and sponsored paths (POP-005).
contract MiningClaimVerifier is Parameterized, EIP712 {
    bytes32 public constant P_QUORUM_WEIGHT = keccak256("verifier.quorum_threshold_weight");

    bytes32 public constant VOTE_TYPEHASH = keccak256(
        "StepValidatorVote(bytes32 claimHash,bytes32 triangleId,address miner,bool approve,bytes32 campaignId)"
    );

    struct ValidatorSig {
        address validator;
        bytes signature;
    }

    TrinityToken public immutable TOKEN;
    MeshRegistry public immutable MESH;
    SafetyRegistry public immutable SAFETY;
    ValidatorRegistry public immutable VALIDATORS;
    TriangleMiningState public immutable STATE;
    FoundationTreasury public immutable TREASURY;
    ProofRegistry public immutable PROOFS;
    RewardPool public immutable POOL;

    mapping(bytes32 => bool) public finalisedClaims;

    event TriangleMined(
        bytes32 indexed triangleId,
        address indexed miner,
        uint256 slot,
        uint256 trinityAmount,
        bytes32 proofHash
    );
    event SponsoredRewardClaimed(
        bytes32 indexed campaignId, address indexed miner, uint256 trinityAmount, bytes32 proofHash
    );

    error ClaimAlreadyFinalised(bytes32 claimHash);
    error TriangleLevelMismatch(uint8 claimLevel, uint8 parsedLevel);
    error TriangleIdMalformed(bytes32 triangleIdHash);
    error ParentTriangleNotExhausted(bytes32 parentTriangleId);
    error TriangleBlocked(bytes32 triangleId);
    error UnsortedOrDuplicateValidator(address validator);
    error SignerMismatch(address expected, address recovered);
    error QuorumNotReached(uint256 got, uint256 required);

    constructor(
        StepAccess access_,
        uint64 paramDelay_,
        uint256 quorumWeight,
        TrinityToken token_,
        MeshRegistry mesh_,
        SafetyRegistry safety_,
        ValidatorRegistry validators_,
        TriangleMiningState state_,
        FoundationTreasury treasury_,
        ProofRegistry proofs_,
        RewardPool pool_
    ) Parameterized(access_, paramDelay_) EIP712("StepMiningClaim", "1") {
        TOKEN = token_;
        MESH = mesh_;
        SAFETY = safety_;
        VALIDATORS = validators_;
        STATE = state_;
        TREASURY = treasury_;
        PROOFS = proofs_;
        POOL = pool_;
        _initParam(P_QUORUM_WEIGHT, quorumWeight);
    }

    function _isKnownParam(bytes32 key) internal pure override returns (bool) {
        return key == P_QUORUM_WEIGHT;
    }

    function _validateParam(bytes32 key, uint256 value) internal pure override {
        if (value == 0) revert InvalidParamValue(key, value);
    }

    /// @notice EIP-712 digest a validator signs to approve a claim. `campaignId`
    ///         binds the vote to a finalisation path/campaign (bytes32(0) for a
    ///         natural claim, the campaign id for a sponsored claim) so a quorum
    ///         signed for one path/campaign can't be replayed onto another (#115).
    function voteDigest(
        bytes32 claimHash,
        bytes32 triangleId,
        address miner,
        bool approve,
        bytes32 campaignId
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VOTE_TYPEHASH, claimHash, triangleId, miner, approve, campaignId))
        );
    }

    /// @dev Verifies the weighted approval quorum (VAL-002). Signatures must be
    ///      ordered by strictly ascending validator address (cheap dedup).
    ///      Only Active validators contribute weight.
    function _checkQuorum(
        bytes32 claimHash,
        bytes32 triangleId,
        address miner,
        bytes32 campaignId,
        ValidatorSig[] calldata sigs
    ) internal view {
        bytes32 digest = voteDigest(claimHash, triangleId, miner, true, campaignId);
        uint256 totalWeight = 0;
        address prev = address(0);
        for (uint256 i = 0; i < sigs.length; i++) {
            address claimed = sigs[i].validator;
            if (claimed <= prev) revert UnsortedOrDuplicateValidator(claimed);
            prev = claimed;
            address recovered = ECDSA.recover(digest, sigs[i].signature);
            if (recovered != claimed) revert SignerMismatch(claimed, recovered);
            totalWeight += VALIDATORS.activeWeight(claimed);
        }
        uint256 required = _params[P_QUORUM_WEIGHT];
        if (totalWeight < required) revert QuorumNotReached(totalWeight, required);
    }

    function _beginFinalise(bytes32 claimHash, bytes32 triangleId) internal {
        if (finalisedClaims[claimHash]) revert ClaimAlreadyFinalised(claimHash);
        finalisedClaims[claimHash] = true;
        if (SAFETY.isTriangleBlocked(triangleId)) revert TriangleBlocked(triangleId);
    }

    function _parseTriangleId(string calldata triangleId)
        internal
        pure
        returns (uint8 level, bytes32 triangleIdHash, bool hasParent, bytes32 parentHash)
    {
        // Mesh ID v2 (docs/geography/STEP_mesh_id_v2.md): dotted, 1-indexed
        //   <face 1..20>(.<child 1..4>)*
        // The level is the number of segments; the parent is the id with its
        // last segment removed. The slot is NOT part of the triangle id.
        bytes memory value = bytes(triangleId);
        uint256 len = value.length;
        triangleIdHash = keccak256(value);
        if (len == 0) revert TriangleIdMalformed(triangleIdHash);

        uint256 segStart = 0;
        uint256 segCount = 0;
        uint256 lastDot = 0;
        for (uint256 i = 0; i <= len; i++) {
            if (i != len && value[i] != 0x2e) continue; // 0x2e = '.'
            uint256 segLen = i - segStart;
            if (segLen == 0 || segLen > 2) revert TriangleIdMalformed(triangleIdHash);
            uint256 num = 0;
            for (uint256 j = segStart; j < i; j++) {
                if (value[j] < 0x30 || value[j] > 0x39) revert TriangleIdMalformed(triangleIdHash);
                num = num * 10 + (uint8(value[j]) - 0x30);
            }
            if (segCount == 0) {
                if (num < 1 || num > 20) revert TriangleIdMalformed(triangleIdHash); // face
            } else {
                if (num < 1 || num > 4) revert TriangleIdMalformed(triangleIdHash); // child
            }
            segCount++;
            if (i != len) lastDot = i;
            segStart = i + 1;
        }

        if (segCount < 1 || segCount > 21) revert TriangleIdMalformed(triangleIdHash);
        level = uint8(segCount);
        hasParent = level > 1;
        if (hasParent) {
            bytes memory parent = new bytes(lastDot);
            for (uint256 k = 0; k < lastDot; k++) parent[k] = value[k];
            parentHash = keccak256(parent);
        }
        return (level, triangleIdHash, hasParent, parentHash);
    }

    /// @notice Finalise a natural mining claim: consume slot, mint reward to the
    ///         miner, allocate the foundation twin, commit the proof hash
    ///         (SYS §23.1 / SYS §8.4 atomic reward logic).
    function finaliseNaturalClaim(
        bytes32 claimHash,
        string calldata triangleId,
        uint8 meshLevel,
        address miner,
        bytes32 proofCidHash,
        ValidatorSig[] calldata sigs
    ) external whenDomainNotPaused(ACCESS.PAUSE_MINTING()) {
        (uint8 parsedLevel, bytes32 triangleIdHash, bool hasParent, bytes32 parentTriangleId) =
            _parseTriangleId(triangleId);

        if (parsedLevel != meshLevel) revert TriangleLevelMismatch(meshLevel, parsedLevel);
        // Mesh ID v2: there is no "non-mineable level" — every level 1..21 is
        // structurally mineable; availability is gated purely by parent
        // exhaustion (genesis level 1 has no parent). A triangle at level N>1
        // is mineable only once its parent (the level it broke down from) is
        // Exhausted. See docs/geography/STEP_mesh_id_v2.md.
        if (hasParent) {
            if (STATE.status(parentTriangleId) != TriangleMiningState.TriangleStatus.Exhausted) {
                revert ParentTriangleNotExhausted(parentTriangleId);
            }
        }

        _beginFinalise(claimHash, triangleIdHash);
        // Natural claims have no campaign: bind the vote to campaignId 0 so these
        // signatures can never satisfy the sponsored path (#115).
        _checkQuorum(claimHash, triangleIdHash, miner, bytes32(0), sigs);

        _mintToMiner(claimHash, triangleIdHash, miner, proofCidHash);
    }

    function _mintToMiner(
        bytes32 claimHash,
        bytes32 triangleIdHash,
        address miner,
        bytes32 proofCidHash
    ) internal {

        (uint32 slot, uint256 reward) = STATE.consumeSlot(triangleIdHash, miner);
        TOKEN.mint(miner, reward);
        TREASURY.allocateTwin(claimHash, reward);
        PROOFS.store(claimHash, triangleIdHash, proofCidHash);

        emit TriangleMined(triangleIdHash, miner, slot, reward, claimHash);
    }

    /// @notice Finalise a sponsored oasis claim: release locked campaign Trinity
    ///         (never minted — TOK-003) after quorum (SYS §23.2).
    function finaliseSponsoredClaim(
        bytes32 claimHash,
        bytes32 triangleId,
        bytes32 campaignId,
        address miner,
        bytes32 proofCidHash,
        ValidatorSig[] calldata sigs
    ) external whenDomainNotPaused(ACCESS.PAUSE_CAMPAIGNS()) {
        _beginFinalise(claimHash, triangleId);
        // Bind the vote to this campaign so a quorum can't be redirected to a
        // different campaign or reused on the natural path (#115).
        _checkQuorum(claimHash, triangleId, miner, campaignId, sigs);

        uint256 amount = POOL.release(campaignId, triangleId, miner);
        PROOFS.store(claimHash, triangleId, proofCidHash);

        emit SponsoredRewardClaimed(campaignId, miner, amount, claimHash);
    }
}
