import Foundation
import Testing

@testable import StepCore

@Suite struct AnchorTests {
    /// Proof window = floor(unix / windowSeconds).
    @Test func windowFloorsToBucket() {
        #expect(AnchorChallenge.window(unixSeconds: 1_700_000_059, windowSeconds: 30) == 56_666_668)
        #expect(AnchorChallenge.window(unixSeconds: 0, windowSeconds: 30) == 0)
    }

    /// nonceHash is keccak256(utf8 nonce), 0x-prefixed 32-byte hex.
    @Test func nonceHashIsKeccakOfNonce() {
        let h = AnchorChallenge.nonceHash(nonce: "nonce-1")
        #expect(h.hasPrefix("0x"))
        #expect(h.count == 2 + 64)
        #expect(h == Keccak.hash256(utf8: "nonce-1").hexString)
    }

    /// abi.encode(address, bytes32, bytes32, uint64) is four left-padded 32B
    /// words; the digest is their keccak256.
    @Test func challengeHashMatchesAbiEncodeLayout() {
        let miner = "0x" + String(repeating: "11", count: 20)
        let nonceHash = "0x" + String(repeating: "22", count: 32)
        let anchorId = "0x" + String(repeating: "33", count: 32)
        let window: UInt64 = 56_666_668

        // Reconstruct the 128-byte preimage independently and hash it.
        var preimage = Data()
        preimage.append(contentsOf: [UInt8](repeating: 0, count: 12)) // address pad
        preimage.append(contentsOf: [UInt8](repeating: 0x11, count: 20))
        preimage.append(contentsOf: [UInt8](repeating: 0x22, count: 32))
        preimage.append(contentsOf: [UInt8](repeating: 0x33, count: 32))
        var word = [UInt8](repeating: 0, count: 32)
        var be = window.bigEndian
        withUnsafeBytes(of: &be) { for (i, b) in $0.enumerated() { word[24 + i] = b } }
        preimage.append(contentsOf: word)
        #expect(preimage.count == 128)

        let got = AnchorChallenge.hash(miner: miner, nonceHash: nonceHash, anchorId: anchorId, window: window)
        #expect(got == Keccak.hash256(preimage))
    }

    /// AnchorProof round-trips through the snake_case wire JSON.
    @Test func anchorProofCodableRoundTrip() throws {
        let proof = AnchorProof(anchorId: "0xabc", kind: .ble, proofWindow: 42, signatureHex: "0xdead")
        let data = try JSONEncoder().encode(proof)
        let json = String(data: data, encoding: .utf8)!
        #expect(json.contains("\"anchor_id\""))
        #expect(json.contains("\"proof_window\""))
        let back = try JSONDecoder().decode(AnchorProof.self, from: data)
        #expect(back == proof)
    }

    /// Anchor proofs ride on the claim as evidence and do NOT change the signed
    /// canonical message (parity-stable, like the other evidence fields).
    @Test func anchorProofsExcludedFromCanonicalMessage() {
        var claim = Claim(
            walletAddress: "0xabc", triangleId: "7.1", meshLevel: 2,
            latitude: 47.4979, longitude: 19.0402, horizontalAccuracyM: 5,
            timestampUtc: "2026-06-17T00:00:00Z", nonce: "n", integrityMode: .devUnattested
        )
        let before = claim.canonicalMessage
        claim.anchorProofs = [AnchorProof(anchorId: "0xabc", kind: .qr, proofWindow: 1, signatureHex: "0x01")]
        #expect(claim.canonicalMessage == before)
    }
}
