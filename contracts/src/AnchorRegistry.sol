// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title AnchorRegistry — trusted physical anchors for location proof (issue #18)
/// @notice A trusted anchor (merchant BLE beacon / NFC tag / rotating QR) is registered
///         with an owner, a triangle binding, and a signing public key. An anchor proves
///         co-location by signing a challenge bound to the miner + nonce + time window.
///         Anchors only corroborate their registered triangle (or a descendant). Keys
///         can be rotated; compromised anchors are suspended (owner or SAFETY_ROLE).
/// @dev    The verification primitive (verifyAnchorProof) is consumed by the validator's
///         multi-signal fusion (#19). No coordinates are stored (PRV-001) — only the
///         triangle id hash + the anchor's signer address.
contract AnchorRegistry is StepManaged {
    using ECDSA for bytes32;

    enum AnchorKind {
        Ble,
        Nfc,
        Qr
    }
    enum AnchorStatus {
        Unregistered,
        Active,
        Suspended
    }

    struct Anchor {
        address owner;
        bytes32 triangleIdHash;
        address signer; // anchor signing key (EOA-style address recovered from sigs)
        AnchorKind kind;
        AnchorStatus status;
        uint64 rotatedAt;
    }

    mapping(bytes32 => Anchor) public anchors; // anchorId -> Anchor

    event AnchorRegistered(
        bytes32 indexed anchorId, address indexed owner, bytes32 indexed triangleIdHash, uint8 kind
    );
    event AnchorKeyRotated(bytes32 indexed anchorId, address newSigner);
    event AnchorStatusChanged(bytes32 indexed anchorId, uint8 status);

    error AnchorExists(bytes32 anchorId);
    error UnknownAnchor(bytes32 anchorId);
    error NotAnchorOwner(bytes32 anchorId, address caller);

    constructor(StepAccess access_) StepManaged(access_) {}

    function registerAnchor(bytes32 anchorId, bytes32 triangleIdHash, address signer, AnchorKind kind)
        external
    {
        if (anchors[anchorId].status != AnchorStatus.Unregistered) revert AnchorExists(anchorId);
        require(signer != address(0), "AnchorRegistry: zero signer");
        anchors[anchorId] = Anchor({
            owner: msg.sender,
            triangleIdHash: triangleIdHash,
            signer: signer,
            kind: kind,
            status: AnchorStatus.Active,
            rotatedAt: uint64(block.timestamp)
        });
        emit AnchorRegistered(anchorId, msg.sender, triangleIdHash, uint8(kind));
    }

    function rotateKey(bytes32 anchorId, address newSigner) external {
        Anchor storage a = anchors[anchorId];
        if (a.status == AnchorStatus.Unregistered) revert UnknownAnchor(anchorId);
        if (a.owner != msg.sender) revert NotAnchorOwner(anchorId, msg.sender);
        require(newSigner != address(0), "AnchorRegistry: zero signer");
        a.signer = newSigner;
        a.rotatedAt = uint64(block.timestamp);
        emit AnchorKeyRotated(anchorId, newSigner);
    }

    /// @notice Suspend/reactivate. Owner may toggle their anchor; SAFETY_ROLE may suspend
    ///         a compromised anchor regardless of owner.
    function setStatus(bytes32 anchorId, AnchorStatus status) external {
        Anchor storage a = anchors[anchorId];
        if (a.status == AnchorStatus.Unregistered) revert UnknownAnchor(anchorId);
        require(status == AnchorStatus.Active || status == AnchorStatus.Suspended, "bad status");
        bool isOwner = a.owner == msg.sender;
        bool isSafety = ACCESS.hasRole(ACCESS.SAFETY_ROLE(), msg.sender);
        require(isOwner || isSafety, "AnchorRegistry: not authorised");
        a.status = status;
        emit AnchorStatusChanged(anchorId, uint8(status));
    }

    function anchorOf(bytes32 anchorId) external view returns (Anchor memory) {
        return anchors[anchorId];
    }

    /// @notice The challenge an anchor signs to attest a miner's presence.
    ///         Bound to miner + nonce + anchor + time window → non-transferable, replay-resistant.
    function challenge(address miner, bytes32 nonceHash, bytes32 anchorId, uint64 window)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(miner, nonceHash, anchorId, window));
    }

    /// @notice An anchor proof submitted for verification (calldata struct keeps the
    ///         external entrypoint under the EVM stack limit).
    struct Proof {
        bytes32 anchorId;
        address miner;
        bytes32 nonceHash;
        uint64 proofWindow;
        bytes signature;
    }

    /// @notice Verify an anchor proof. Returns (present, valid, triangleIdHash, kind).
    ///         `valid` requires: active anchor, signature by the registered signer over the
    ///         challenge for the proof's window, and the window within tolerance of
    ///         `nowWindow`. Triangle binding is enforced by the caller (#19) against the
    ///         claim's triangle (equal or descendant).
    function verifyAnchorProof(Proof calldata p, uint64 nowWindow, uint64 windowTolerance)
        external
        view
        returns (bool present, bool valid, bytes32 triangleIdHash, uint8 kind)
    {
        Anchor storage a = anchors[p.anchorId];
        if (a.status == AnchorStatus.Unregistered) return (false, false, bytes32(0), 0);
        present = true;
        triangleIdHash = a.triangleIdHash;
        kind = uint8(a.kind);
        if (a.status != AnchorStatus.Active) return (present, false, triangleIdHash, kind);
        uint64 diff = nowWindow > p.proofWindow ? nowWindow - p.proofWindow : p.proofWindow - nowWindow;
        if (diff > windowTolerance) return (present, false, triangleIdHash, kind);
        bytes32 c = challenge(p.miner, p.nonceHash, p.anchorId, p.proofWindow);
        valid = c.recover(p.signature) == a.signer;
    }
}
