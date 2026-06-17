// Trusted-anchor capture wire types (M7 #32). A trusted anchor (BLE beacon /
// NFC tag / rotating QR registered in AnchorRegistry #18) signs a challenge over
// (miner, nonceHash, anchorId, window) attesting physical co-location. The app
// captures that signature and attaches an `AnchorProof` to the claim as
// evidence, so the validator's multi-signal fusion (#19) can corroborate
// presence beyond GPS and the chain can `verifyAnchorProof`.
//
// These types are transport-only (no CoreBluetooth/CoreNFC/AVFoundation) so
// StepCore stays macOS-buildable; the radio/camera readers live in StepAppUI
// behind `#if canImport(...)`.
import Foundation

public enum AnchorKind: String, Codable, Sendable, CaseIterable {
    case ble
    case nfc
    case qr
}

/// A captured anchor proof, attached to the claim evidence bundle. Matches
/// `AnchorRegistry.Proof = {anchorId, miner, nonceHash, proofWindow, signature}`
/// minus the miner/nonceHash that the validator already has from the claim.
public struct AnchorProof: Codable, Sendable, Equatable {
    public let anchorId: String      // bytes32 hex (0x…)
    public let kind: AnchorKind
    public let proofWindow: UInt64
    public let signatureHex: String  // anchor's signature over the challenge

    public init(anchorId: String, kind: AnchorKind, proofWindow: UInt64, signatureHex: String) {
        self.anchorId = anchorId
        self.kind = kind
        self.proofWindow = proofWindow
        self.signatureHex = signatureHex
    }

    enum CodingKeys: String, CodingKey {
        case anchorId = "anchor_id"
        case kind
        case proofWindow = "proof_window"
        case signatureHex = "signature"
    }
}

/// Captures an anchor proof for a claim. Implemented per-transport in the iOS
/// layer (BLE/NFC/QR); the proof is bound to the miner + claim nonce so it can
/// never be replayed across claims.
public protocol AnchorCapturing: Sendable {
    func capture(minerAddress: String, nonceHash: String) async throws -> AnchorProof
}

/// Challenge construction, byte-identical to `AnchorRegistry.challenge`:
/// `keccak256(abi.encode(miner, nonceHash, anchorId, window))`. Used to drive a
/// real anchor (BLE write payload) and to simulate one in tests.
public enum AnchorChallenge {
    /// Proof window = floor(unix seconds / windowSeconds). The validator allows
    /// ±windowTolerance windows for clock skew (AnchorRegistry).
    public static func window(unixSeconds: UInt64, windowSeconds: UInt64 = 30) -> UInt64 {
        windowSeconds == 0 ? unixSeconds : unixSeconds / windowSeconds
    }

    /// nonceHash = keccak256(utf8 nonce) — the bytes32 the validator derives
    /// from the claim nonce when it reconstructs the challenge.
    public static func nonceHash(nonce: String) -> String {
        Keccak.hash256(utf8: nonce).hexString // hexString already prefixes 0x
    }

    /// keccak256(abi.encode(address miner, bytes32 nonceHash, bytes32 anchorId, uint64 window)).
    /// abi.encode left-pads each argument to a 32-byte word.
    public static func hash(miner: String, nonceHash: String, anchorId: String, window: UInt64) -> Data {
        var encoded = Data()
        encoded.append(word(fromHex: miner, byteWidth: 20))   // address → right-aligned in 32B
        encoded.append(word(fromHex: nonceHash, byteWidth: 32))
        encoded.append(word(fromHex: anchorId, byteWidth: 32))
        encoded.append(word(uint64: window))
        return Keccak.hash256(encoded)
    }

    /// Right-align `byteWidth` bytes parsed from `hex` into a 32-byte word.
    private static func word(fromHex hex: String, byteWidth: Int) -> Data {
        let raw = Data(hexString: hex) ?? Data()
        let trimmed = raw.suffix(byteWidth)
        var word = Data(repeating: 0, count: 32)
        word.replaceSubrange((32 - trimmed.count)..<32, with: trimmed)
        return word
    }

    private static func word(uint64 value: UInt64) -> Data {
        var word = Data(repeating: 0, count: 32)
        var be = value.bigEndian
        let bytes = withUnsafeBytes(of: &be) { Data($0) } // 8 bytes
        word.replaceSubrange(24..<32, with: bytes)
        return word
    }
}
