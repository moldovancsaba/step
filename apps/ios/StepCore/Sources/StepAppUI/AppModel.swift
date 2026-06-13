// App-level state machine for the miner app (DEV §6.3 flows A and B).
// Cross-platform (compiles on macOS for CI); CoreLocation wiring lives in
// LocationService below, used by the iOS app target.
import Foundation
import StepCore
#if canImport(CoreLocation)
import CoreLocation
#endif

public enum ClaimUIStatus: Equatable, Sendable {
    case idle
    case locating
    case resolvingTriangle
    case readyToMine(triangle: String)
    case submitting
    case validating
    case finalised(txHash: String?)
    case rejected(reasons: [String])
    case error(String)
}

@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var walletAddress: String?
    @Published public private(set) var currentTriangle: TriangleInfo?
    @Published public private(set) var status: ClaimUIStatus = .idle
    @Published public private(set) var claimHistory: [ClaimRecord] = []
    @Published public var privacyMode: PrivacyMode = .privateMiner

    public enum PrivacyMode: String, CaseIterable, Sendable {
        // Default is privacy-protective (HARD §13.4).
        case privateMiner = "Private"
        case pseudonymous = "Pseudonymous"
        case publicExplorer = "Public explorer"
    }

    let keyStore: KeyStore
    let client: GatewayClient
    var wallet: Wallet?

    public init(keyStore: KeyStore, client: GatewayClient) {
        self.keyStore = keyStore
        self.client = client
        if let existing = try? Wallet.load(store: keyStore) {
            wallet = existing
            walletAddress = existing.address
        }
    }

    /// Flow A step 4–5: create wallet, store key securely.
    public func createWallet() {
        do {
            let created = try Wallet.create(store: keyStore)
            wallet = created
            walletAddress = created.address
        } catch {
            status = .error("wallet creation failed: \(error.localizedDescription)")
        }
    }

    public func importWallet(privateKeyHex: String) {
        do {
            guard let data = Data(hexString: privateKeyHex) else { throw WalletError.invalidKey }
            try keyStore.save(data)
            let imported = try Wallet(privateKeyData: data)
            wallet = imported
            walletAddress = imported.address
        } catch {
            status = .error("invalid key")
        }
    }

    /// Flow B steps 1–3: resolve the current triangle from a location sample.
    public func updateLocation(_ sample: LocationSample, level: Int = 21) async {
        status = .resolvingTriangle
        do {
            let triangle = try await client.resolveTriangle(
                lat: sample.latitude, lon: sample.longitude, level: level
            )
            currentTriangle = triangle
            status = .readyToMine(triangle: triangle.triangleId)
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    /// Flow B steps 6–10: nonce → signed claim → submit → status.
    public func mine(at sample: LocationSample, attestation: AttestationEvidence) async {
        guard let wallet, let triangle = currentTriangle else {
            status = .error("wallet and triangle required")
            return
        }
        status = .submitting
        do {
            let nonce = try await client.requestNonce(wallet: wallet.address)
            let claim = try ClaimBuilder.makeClaim(
                wallet: wallet,
                triangle: triangle,
                location: sample,
                nonce: nonce.nonce,
                attestation: attestation
            )
            status = .validating
            let record = try await client.submit(claim: claim)
            claimHistory.insert(record, at: 0)
            switch record.status {
            case "finalised":
                status = .finalised(txHash: record.txHash)
            case "rejected":
                status = .rejected(reasons: record.rejectReasons)
            default:
                status = .validating
            }
        } catch {
            status = .error(error.localizedDescription)
        }
    }
}

#if canImport(CoreLocation)
/// Core Location wrapper (DEV §6.2 Core/Location). One-shot precise fixes;
/// no background tracking in alpha (privacy minimisation, PRV-005).
public final class LocationService: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<LocationSample, Error>?

    public override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    public func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    public func currentLocation() async throws -> LocationSample {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        continuation?.resume(
            returning: LocationSample(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                horizontalAccuracyM: location.horizontalAccuracy,
                timestamp: location.timestamp
            )
        )
        continuation = nil
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}
#endif
