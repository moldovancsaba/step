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
    /// Indexer state lookup; when present, mining resolves the current mineable
    /// triangle via the v2 genesis→breakdown walk instead of a fixed level.
    let stateProvider: TriangleStateProviding?
    /// account-api client; when present the login wall (#27) gates the app with
    /// a zero-knowledge vault instead of the device-local-key onboarding.
    let account: AccountClient?
    var wallet: Wallet?

    public init(
        keyStore: KeyStore,
        client: GatewayClient,
        stateProvider: TriangleStateProviding? = nil,
        account: AccountClient? = nil
    ) {
        self.keyStore = keyStore
        self.client = client
        self.stateProvider = stateProvider
        self.account = account
        if let existing = try? Wallet.load(store: keyStore) {
            wallet = existing
            walletAddress = existing.address
        }
    }

    /// True when the app is configured for account/login (#27) rather than the
    /// device-local-key onboarding.
    public var hasAccount: Bool { account != nil }

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

    /// Sign out: clear the in-memory wallet/session and reset UI state. The key
    /// remains in the KeyStore (Keychain) unless explicitly deleted; the login
    /// wall (#27) decrypts it back into memory on next sign-in.
    public func signOut() {
        wallet = nil
        walletAddress = nil
        currentTriangle = nil
        claimHistory = []
        status = .idle
        if let account { Task { try? await account.logout() } }
    }

    @Published public private(set) var authError: String?

    public func clearAuthError() { authError = nil }

    /// Login wall (#27) — register: derive keys client-side, encrypt the wallet
    /// (existing key or a fresh one), POST the verifier + ciphertext, then sign
    /// in. Zero-knowledge: the password/wrapKey never leave the device.
    public func register(identity: String, password: String) async {
        guard let account else { return }
        authError = nil
        do {
            let walletKey = (try? keyStore.load()) ?? Self.freshWalletKey()
            let blob = try await Self.offMain { try AccountVault.encrypt(password: password, walletKey: walletKey) }
            try await account.register(identity: identity, blob: blob)
            Self.cacheKdf(blob.kdf, for: identity)        // salt is not secret
            try keyStore.save(walletKey)
            _ = try await account.login(identity: identity, authKey: blob.authKey)  // obtain session cookie
            adopt(walletKey: walletKey, identity: identity)
        } catch {
            authError = Self.authMessage(error)
        }
    }

    /// Login wall (#27) — sign in: derive authKey from the cached KDF salt,
    /// fetch the ciphertext, decrypt the wallet into the KeyStore.
    public func signIn(identity: String, password: String) async {
        guard let account else { return }
        authError = nil
        guard let kdf = Self.cachedKdf(for: identity) else {
            authError = "No saved key parameters on this device. Create an account here, or import your key."
            return
        }
        do {
            let authKey = try await Self.offMain { try AccountVault.deriveAuthKey(password: password, kdf: kdf) }
            let res = try await account.login(identity: identity, authKey: authKey)
            let key = try await Self.offMain {
                try AccountVault.decrypt(password: password, ciphertext: res.ciphertext, iv: res.iv, kdf: res.kdf)
            }
            try keyStore.save(key)
            adopt(walletKey: key, identity: identity)
        } catch {
            authError = Self.authMessage(error)
        }
    }

    private func adopt(walletKey: Data, identity: String) {
        if let w = try? Wallet(privateKeyData: walletKey) {
            wallet = w
            walletAddress = w.address
            status = .idle
        } else {
            authError = "Corrupted wallet key."
        }
    }

    // MARK: account helpers

    /// Run a CPU-heavy block (Argon2id) off the main actor.
    private static func offMain<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await Task.detached(priority: .userInitiated) { try work() }.value
    }

    private static func freshWalletKey() -> Data {
        while true {
            let candidate = AccountVault.randomBytes(32)
            if (try? Wallet(privateKeyData: candidate)) != nil { return candidate }
        }
    }

    private static func authMessage(_ error: Error) -> String {
        switch error {
        case AccountError.identityTaken: return "That email/username is already taken."
        case AccountError.invalidCredentials: return "Invalid credentials."
        case VaultError.decrypt: return "Wrong password or corrupted vault."
        default: return "Sign-in failed. Check your connection and try again."
        }
    }

    private static func kdfKey(_ identity: String) -> String { "step.kdf.\(identity.lowercased())" }

    private static func cacheKdf(_ kdf: KdfParams, for identity: String) {
        if let data = try? JSONEncoder().encode(kdf) {
            UserDefaults.standard.set(data, forKey: kdfKey(identity))
        }
    }

    private static func cachedKdf(for identity: String) -> KdfParams? {
        guard let data = UserDefaults.standard.data(forKey: kdfKey(identity)) else { return nil }
        return try? JSONDecoder().decode(KdfParams.self, from: data)
    }

    /// Flow B steps 1–3: resolve the current mineable triangle from a location.
    /// With a `stateProvider`, this walks genesis level 1 → 21 and picks the
    /// finest un-exhausted triangle (v2 model); otherwise it resolves at `level`
    /// (default genesis 1).
    public func updateLocation(_ sample: LocationSample, level: Int = 1) async {
        status = .resolvingTriangle
        do {
            let triangle: TriangleInfo
            if let stateProvider {
                let resolver = MineableResolver(resolver: client, state: stateProvider)
                triangle = try await resolver.currentMineable(
                    lat: sample.latitude, lon: sample.longitude
                ).triangle
            } else {
                triangle = try await client.resolveTriangle(
                    lat: sample.latitude, lon: sample.longitude, level: level
                )
            }
            currentTriangle = triangle
            status = .readyToMine(triangle: triangle.triangleId)
        } catch let e as MineableError {
            switch e {
            case .desert:
                status = .error("This location is fully mined (desert). It reopens only via a merchant campaign.")
            case .frozen(let id):
                status = .error("Triangle \(id) is frozen by safety policy.")
            }
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
