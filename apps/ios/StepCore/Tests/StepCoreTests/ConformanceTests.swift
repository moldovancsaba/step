// Cross-language conformance: Swift must produce byte-identical canonical
// messages, hashes, and (RFC-6979 deterministic) signatures to the Rust
// reference, replaying the same committed vector as the TypeScript suite.
import Foundation
import Testing
@testable import StepCore

@Suite struct KeccakTests {
    @Test func emptyStringVector() {
        #expect(
            Keccak.hash256(Data()).hexString
                == "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        )
    }

    @Test func abcVector() {
        #expect(
            Keccak.hash256(utf8: "abc").hexString
                == "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
        )
    }
}

struct Vector: Decodable {
    let miner_private_key: String
    let wallet: String
    let triangle_id: String
    let nonce: String
    let canonical_message: String
    let claim_hash: String
    let triangle_id_hash: String
    let miner_signature: String
    let claim_json: VectorClaim
}

struct VectorClaim: Decodable {
    let wallet_address: String
    let triangle_id: String
    let mesh_level: Int
    let latitude: Double
    let longitude: Double
    let horizontal_accuracy_m: Double
    let timestamp_utc: String
    let nonce: String
}

func loadVector() throws -> Vector {
    let url = Bundle.module.url(
        forResource: "cross-language-vector.v1", withExtension: "json",
        subdirectory: "Fixtures"
    )!
    return try JSONDecoder().decode(Vector.self, from: Data(contentsOf: url))
}

func makeClaim(_ vector: Vector) -> Claim {
    Claim(
        walletAddress: vector.claim_json.wallet_address,
        triangleId: vector.claim_json.triangle_id,
        meshLevel: vector.claim_json.mesh_level,
        latitude: vector.claim_json.latitude,
        longitude: vector.claim_json.longitude,
        horizontalAccuracyM: vector.claim_json.horizontal_accuracy_m,
        timestampUtc: vector.claim_json.timestamp_utc,
        nonce: vector.claim_json.nonce,
        integrityMode: .devUnattested
    )
}

@Suite struct ConformanceTests {
    @Test func canonicalMessageMatchesRust() throws {
        let vector = try loadVector()
        #expect(makeClaim(vector).canonicalMessage == vector.canonical_message)
    }

    @Test func claimAndTriangleHashesMatchRust() throws {
        let vector = try loadVector()
        let claim = makeClaim(vector)
        #expect(claim.claimHash.hexString == vector.claim_hash)
        #expect(claim.triangleIdHash.hexString == vector.triangle_id_hash)
    }

    @Test func signatureReproducesRustExactly() throws {
        // RFC-6979 deterministic ECDSA: the same key over the same digest must
        // yield the same signature bytes as k256 produced in Rust.
        let vector = try loadVector()
        let wallet = try Wallet(privateKeyData: Data(hexString: vector.miner_private_key)!)
        #expect(wallet.address.lowercased() == vector.wallet.lowercased())

        var claim = makeClaim(vector)
        try wallet.sign(claim: &claim)
        #expect(claim.signature.lowercased() == vector.miner_signature.lowercased())
    }

    @Test func tamperedFieldChangesDigest() throws {
        let vector = try loadVector()
        var claim = makeClaim(vector)
        let original = claim.personalDigest
        claim.horizontalAccuracyM += 0.01
        #expect(claim.personalDigest != original)
    }
}

@Suite struct ClaimBuilderTests {
    @Test func buildSignedClaimFromComponents() throws {
        let store = InMemoryKeyStore()
        let wallet = try Wallet.create(store: store)
        let triangle = TriangleInfo(
            triangleId: "STEP-21-F00-12203302320201311132",
            triangleIdHash: "0xabc",
            level: 21,
            vertices: [.init(lat: 47.4979, lon: 19.0402)],
            centroid: .init(lat: 47.4979, lon: 19.0402),
            areaM2: 20,
            minSideM: 6.7,
            parent: nil,
            neighbours: []
        )
        let claim = try ClaimBuilder.makeClaim(
            wallet: wallet,
            triangle: triangle,
            location: LocationSample(latitude: 47.4979, longitude: 19.0402, horizontalAccuracyM: 5),
            nonce: "test-nonce-1234567890",
            attestation: .devUnattested
        )
        #expect(claim.integrityMode == .devUnattested)
        #expect(claim.walletAddress == wallet.address)
        #expect(claim.signature.count == 2 + 65 * 2) // 0x + 65 bytes hex
        #expect(claim.timestampUtc.hasSuffix("Z"))

        // Wallet persistence round trip.
        let reloaded = try Wallet.load(store: store)
        #expect(reloaded.address == wallet.address)
    }

    @Test func attestedModeCarriesTokens() throws {
        let wallet = try Wallet.create(store: InMemoryKeyStore())
        let triangle = TriangleInfo(
            triangleId: "STEP-21-F00-1", triangleIdHash: "0x", level: 21,
            vertices: [], centroid: .init(lat: 0, lon: 0), areaM2: 0, minSideM: 0,
            parent: nil, neighbours: []
        )
        let claim = try ClaimBuilder.makeClaim(
            wallet: wallet,
            triangle: triangle,
            location: LocationSample(latitude: 1, longitude: 2, horizontalAccuracyM: 5),
            nonce: "test-nonce-1234567890",
            attestation: .attested(appAttest: "token-a", deviceCheck: "token-d")
        )
        #expect(claim.integrityMode == .attested)
        #expect(claim.appAttestation == "token-a")
        #expect(claim.deviceIntegrity == "token-d")
    }
}
