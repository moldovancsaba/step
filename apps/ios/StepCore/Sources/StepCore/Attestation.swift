// Device attestation (M7 #31). Produces AttestationEvidence bound to a claim's
// hash so validators / multi-signal fusion (#19) can weight genuine-device
// proofs higher and reject emulator/farm claims (HARD §17.1).
//
// `Attesting` is cross-platform; `UnattestedAttester` works everywhere (the
// honest, clearly-tiered fallback for Simulator / unsupported devices / macOS).
// `AppAttestAttester` is iOS-only (Apple App Attest via DeviceCheck) and is
// compiled only under os(iOS) so the package still builds + tests on macOS CI.
//
// Wire mapping into the existing AttestationEvidence.attested(appAttest:
// deviceCheck:): appAttest = base64 assertion (bound to the claim hash),
// deviceCheck = the attested key id (so the server can look up the registered
// key). Server-side verification of the assertion is a paired backend issue.
import Foundation

public protocol Attesting: Sendable {
    /// Produce attestation evidence for a claim, bound to its `claimHash`.
    func evidence(forClaimHash claimHash: Data) async throws -> AttestationEvidence
}

/// Fallback attester — always returns the clearly-marked unattested tier. Used
/// on Simulator / unsupported devices / macOS. Never silently claims "attested".
public struct UnattestedAttester: Attesting {
    public init() {}
    public func evidence(forClaimHash claimHash: Data) async throws -> AttestationEvidence {
        .devUnattested
    }
}

#if os(iOS)
import DeviceCheck

/// Apple App Attest attester. Generates a hardware-backed key once, attests it
/// (the attestation object must be registered server-side — paired backend
/// issue), then produces a per-claim assertion over the claim hash. Falls back
/// to `.devUnattested` when App Attest is unsupported.
public final class AppAttestAttester: Attesting, @unchecked Sendable {
    private let service = DCAppAttestService.shared
    private let keyIdDefault = "step.appattest.keyId"

    public init() {}

    public func evidence(forClaimHash claimHash: Data) async throws -> AttestationEvidence {
        guard service.isSupported else { return .devUnattested }
        let keyId = try await ensureAttestedKey(clientDataHash: claimHash)
        let assertion = try await generateAssertion(keyId: keyId, clientDataHash: claimHash)
        return .attested(appAttest: assertion.base64EncodedString(), deviceCheck: keyId)
    }

    /// Reuse the stored attested key, or generate + attest a fresh one once.
    private func ensureAttestedKey(clientDataHash: Data) async throws -> String {
        if let existing = UserDefaults.standard.string(forKey: keyIdDefault) { return existing }
        let keyId = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            service.generateKey { id, error in
                if let id { cont.resume(returning: id) } else { cont.resume(throwing: error ?? AttestError.keygen) }
            }
        }
        // Attest the new key (the attestation object is registered server-side).
        _ = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
            service.attestKey(keyId, clientDataHash: clientDataHash) { object, error in
                if let object { cont.resume(returning: object) } else { cont.resume(throwing: error ?? AttestError.attest) }
            }
        }
        UserDefaults.standard.set(keyId, forKey: keyIdDefault)
        return keyId
    }

    private func generateAssertion(keyId: String, clientDataHash: Data) async throws -> Data {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
            service.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
                if let assertion { cont.resume(returning: assertion) } else { cont.resume(throwing: error ?? AttestError.assert) }
            }
        }
    }

    enum AttestError: Error { case keygen, attest, assert }
}
#endif
