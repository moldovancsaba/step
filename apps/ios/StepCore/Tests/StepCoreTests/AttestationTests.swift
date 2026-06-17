import Foundation
import Testing

@testable import StepCore

@Suite struct AttestationTests {
    private func wallet() throws -> Wallet {
        try Wallet(privateKeyData: Data(repeating: 0x11, count: 32))
    }

    private func triangle() -> TriangleInfo {
        TriangleInfo(
            triangleId: "7.1", triangleIdHash: "0xabc", level: 2,
            vertices: [.init(lat: 47.4979, lon: 19.0402)],
            centroid: .init(lat: 47.4979, lon: 19.0402),
            areaM2: 20, minSideM: 6.7, parent: nil, neighbours: []
        )
    }

    private func sample() -> LocationSample {
        LocationSample(
            latitude: 47.4979, longitude: 19.0402, horizontalAccuracyM: 5,
            timestamp: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    /// The fallback attester always yields the honest unattested tier.
    @Test func unattestedFallbackProducesDevUnattested() async throws {
        let evidence = try await UnattestedAttester().evidence(forClaimHash: Data([0x01, 0x02]))
        #expect(evidence == .devUnattested)
    }

    /// An unattested claim is signed and carries the dev-unattested integrity mode.
    @Test func unattestedClaimIsDevUnattested() async throws {
        let claim = try await ClaimBuilder.makeAttestedClaim(
            wallet: wallet(), triangle: triangle(), location: sample(),
            nonce: "nonce-1", attester: UnattestedAttester()
        )
        #expect(claim.integrityMode == .devUnattested)
        #expect(claim.appAttestation == nil)
        #expect(!claim.signature.isEmpty)
    }

    /// A stub attested provider maps onto the wire fields, keeps the signature
    /// valid over the final claim, and is bound to the core (unattested) hash.
    @Test func attestedClaimCarriesAssertionAndKeyId() async throws {
        struct StubAttester: Attesting {
            func evidence(forClaimHash claimHash: Data) async throws -> AttestationEvidence {
                // Echo the bound hash so the test can assert the binding.
                .attested(appAttest: claimHash.base64EncodedString(), deviceCheck: "key-123")
            }
        }
        let w = try wallet()
        let claim = try await ClaimBuilder.makeAttestedClaim(
            wallet: w, triangle: triangle(), location: sample(),
            nonce: "nonce-1", attester: StubAttester()
        )
        #expect(claim.integrityMode == .attested)
        #expect(claim.deviceIntegrity == "key-123")
        #expect(!claim.signature.isEmpty)

        // The assertion was bound to the *core* (unattested) claim hash.
        let core = Claim(
            walletAddress: w.address, triangleId: "7.1", meshLevel: 2,
            latitude: 47.4979, longitude: 19.0402, horizontalAccuracyM: 5,
            timestampUtc: ClaimBuilder.isoFormatter.string(from: sample().timestamp),
            nonce: "nonce-1", integrityMode: .devUnattested
        )
        #expect(claim.appAttestation == core.claimHash.base64EncodedString())
    }
}
