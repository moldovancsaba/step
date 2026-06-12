// The STEP-CLAIM-V1 canonical message and claim model (POP-002, DEV §6.4).
// Must produce byte-identical output to the Rust reference
// (packages/validation-rules/src/claim.rs) — proven by ConformanceTests
// replaying packages/schemas/cross-language-vector.v1.json.
import Foundation

public enum IntegrityMode: String, Codable, Sendable {
    case attested
    case devUnattested = "dev-unattested"
    case failed
}

public struct MerchantProof: Codable, Sendable {
    public let kind: String
    public let payload: String

    public init(kind: String = "qr", payload: String) {
        self.kind = kind
        self.payload = payload
    }
}

public struct Claim: Codable, Sendable {
    public var schemaVersion: String = "step.proof.location.v1"
    public var walletAddress: String
    public var triangleId: String
    public var meshLevel: Int
    public var latitude: Double
    public var longitude: Double
    public var horizontalAccuracyM: Double
    public var timestampUtc: String
    public var nonce: String
    public var integrityMode: IntegrityMode
    public var appAttestation: String?
    public var deviceIntegrity: String?
    public var previousClaimHash: String?
    public var campaignId: String?
    public var merchantProof: MerchantProof?
    public var signature: String = ""

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case walletAddress = "wallet_address"
        case triangleId = "triangle_id"
        case meshLevel = "mesh_level"
        case latitude
        case longitude
        case horizontalAccuracyM = "horizontal_accuracy_m"
        case timestampUtc = "timestamp_utc"
        case nonce
        case integrityMode = "integrity_mode"
        case appAttestation = "app_attestation"
        case deviceIntegrity = "device_integrity"
        case previousClaimHash = "previous_claim_hash"
        case campaignId = "campaign_id"
        case merchantProof = "merchant_proof"
        case signature
    }

    /// Fixed-decimal formatter matching Rust `{:.N}` for the value ranges in
    /// use; conformance is pinned by the vector test, not by convention.
    static func fixed(_ value: Double, _ places: Int) -> String {
        String(format: "%.\(places)f", value)
    }

    /// The exact bytes the wallet signs (EIP-191 personal message) and whose
    /// keccak256 is the protocol-wide claim hash.
    public var canonicalMessage: String {
        """
        STEP-CLAIM-V1
        wallet=\(walletAddress.lowercased())
        triangle=\(triangleId)
        level=\(meshLevel)
        lat=\(Self.fixed(latitude, 7))
        lon=\(Self.fixed(longitude, 7))
        acc=\(Self.fixed(horizontalAccuracyM, 2))
        ts=\(timestampUtc)
        nonce=\(nonce)
        integrity=\(integrityMode.rawValue)
        campaign=\(campaignId ?? "-")
        prev=\(previousClaimHash ?? "-")

        """
    }

    public var claimHash: Data { Keccak.hash256(utf8: canonicalMessage) }

    public var triangleIdHash: Data { Keccak.hash256(utf8: triangleId) }

    /// EIP-191 personal-message digest of the canonical message.
    public var personalDigest: Data {
        let body = Data(canonicalMessage.utf8)
        var prefixed = Data("\u{19}Ethereum Signed Message:\n\(body.count)".utf8)
        prefixed.append(body)
        return Keccak.hash256(prefixed)
    }
}
