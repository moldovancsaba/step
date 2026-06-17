// Claim assembly (DEV §6.2 Core/Proof): location sample + nonce + integrity
// evidence → signed claim. Integrity modes are explicit and never silently
// upgraded (ADR-015): on simulator/dev builds the claim carries
// `dev-unattested` and pilot validators reject it.
import Foundation

public struct LocationSample: Sendable {
    public let latitude: Double
    public let longitude: Double
    public let horizontalAccuracyM: Double
    public let timestamp: Date

    public init(latitude: Double, longitude: Double, horizontalAccuracyM: Double, timestamp: Date = Date()) {
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracyM = horizontalAccuracyM
        self.timestamp = timestamp
    }
}

public enum AttestationEvidence: Sendable {
    /// Real App Attest + DeviceCheck tokens (production path; obtained via
    /// DCAppAttestService in the app target — see apps/ios/README).
    case attested(appAttest: String, deviceCheck: String)
    /// Simulator / local development. Never accepted by pilot validators.
    case devUnattested
}

public enum ClaimBuilder {
    static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime] // second precision, Z suffix
        return formatter
    }()

    /// Builds and signs a claim. The wallet signature covers every protocol
    /// field via the canonical message; any later mutation invalidates it.
    public static func makeClaim(
        wallet: Wallet,
        triangle: TriangleInfo,
        location: LocationSample,
        nonce: String,
        attestation: AttestationEvidence,
        campaignId: String? = nil,
        merchantQrPayload: String? = nil,
        previousClaimHash: String? = nil
    ) throws -> Claim {
        var claim = Claim(
            walletAddress: wallet.address,
            triangleId: triangle.triangleId,
            meshLevel: triangle.level,
            latitude: location.latitude,
            longitude: location.longitude,
            horizontalAccuracyM: location.horizontalAccuracyM,
            timestampUtc: isoFormatter.string(from: location.timestamp),
            nonce: nonce,
            integrityMode: .devUnattested
        )
        switch attestation {
        case .attested(let appAttest, let deviceCheck):
            claim.integrityMode = .attested
            claim.appAttestation = appAttest
            claim.deviceIntegrity = deviceCheck
        case .devUnattested:
            claim.integrityMode = .devUnattested
        }
        claim.campaignId = campaignId
        if let payload = merchantQrPayload {
            claim.merchantProof = MerchantProof(payload: payload)
        }
        claim.previousClaimHash = previousClaimHash
        try wallet.sign(claim: &claim)
        return claim
    }

    /// Build + sign a claim whose attestation evidence (#31) is produced by an
    /// `Attesting` provider and bound to the claim's *core* hash (the hash of
    /// the unattested claim). The provider runs before the wallet signature, so
    /// the single signature still covers the final attested claim. The server
    /// recomputes the same core hash to verify an App Attest assertion.
    public static func makeAttestedClaim(
        wallet: Wallet,
        triangle: TriangleInfo,
        location: LocationSample,
        nonce: String,
        attester: Attesting,
        anchorProofs: [AnchorProof]? = nil,
        campaignId: String? = nil,
        merchantQrPayload: String? = nil,
        previousClaimHash: String? = nil
    ) async throws -> Claim {
        var claim = Claim(
            walletAddress: wallet.address,
            triangleId: triangle.triangleId,
            meshLevel: triangle.level,
            latitude: location.latitude,
            longitude: location.longitude,
            horizontalAccuracyM: location.horizontalAccuracyM,
            timestampUtc: isoFormatter.string(from: location.timestamp),
            nonce: nonce,
            integrityMode: .devUnattested
        )
        claim.campaignId = campaignId
        if let payload = merchantQrPayload { claim.merchantProof = MerchantProof(payload: payload) }
        claim.anchorProofs = anchorProofs
        claim.previousClaimHash = previousClaimHash
        // Bind attestation to the core (unattested) claim hash, then apply it.
        let evidence = try await attester.evidence(forClaimHash: claim.claimHash)
        switch evidence {
        case .attested(let appAttest, let deviceCheck):
            claim.integrityMode = .attested
            claim.appAttestation = appAttest
            claim.deviceIntegrity = deviceCheck
        case .devUnattested:
            claim.integrityMode = .devUnattested
        }
        try wallet.sign(claim: &claim)
        return claim
    }
}
