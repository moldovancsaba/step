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
    public enum LauncherMode: String, CaseIterable, Sendable {
        case miner = "Mine & explore"
        case mobileTrustCenter = "Mobile Trust Center"
    }

    @Published public private(set) var walletAddress: String?
    @Published public private(set) var currentTriangle: TriangleInfo?
    @Published public private(set) var status: ClaimUIStatus = .idle
    @Published public private(set) var claimHistory: [ClaimRecord] = []
    @Published public var privacyMode: PrivacyMode = .privateMiner
    @Published public private(set) var launcherMode: LauncherMode?
    @Published public private(set) var mobileTrustCenterActive = false

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
    /// nft-indexer client for the Wallet tab's owned slot NFTs (#29).
    let nft: NftClient?
    /// Marketplace read client (#30); nil hides the marketplace browse path.
    let market: MarketplaceClient?
    /// JSON-RPC endpoint + deployed addresses for marketplace writes (#30); both
    /// present → trading is enabled, else the tab shows a "not deployed" state.
    let rpcURL: URL?
    let marketAddresses: MarketplaceAddresses?
    /// Viewport cover + depletion client for the oasis/desert map (#28).
    public let cover: MeshCoverClient?
    /// Canonical web globe surface. iOS embeds this for the production mesh map
    /// because MapLibre GL JS v5 owns the proven globe projection path.
    public let webAppURL: URL?
    /// Device attestation provider (#31). Defaults to the honest unattested
    /// fallback; the app wires `AppAttestAttester()` on a real iOS device.
    let attester: Attesting
    var wallet: Wallet?
    /// Raw wallet key + identity for the current session — used to export a key
    /// backup and to store the key on a trusted device. Never persisted in clear.
    private var walletKeyData: Data?
    private var currentIdentity: String?

    /// Owned slot NFTs for the Wallet tab (#29).
    @Published public private(set) var ownedNfts: LoadPhase<[NftToken]> = .idle

    /// Optional trusted-anchor proof (#32) captured for the next claim. Cleared
    /// after a claim is submitted so a proof is never replayed across claims.
    @Published public var capturedAnchor: AnchorProof?

    public init(
        keyStore: KeyStore,
        client: GatewayClient,
        stateProvider: TriangleStateProviding? = nil,
        account: AccountClient? = nil,
        nft: NftClient? = nil,
        cover: MeshCoverClient? = nil,
        webAppURL: URL? = nil,
        market: MarketplaceClient? = nil,
        rpcURL: URL? = nil,
        marketAddresses: MarketplaceAddresses? = nil,
        attester: Attesting = UnattestedAttester()
    ) {
        self.keyStore = keyStore
        self.client = client
        self.stateProvider = stateProvider
        self.account = account
        self.nft = nft
        self.cover = cover
        self.webAppURL = webAppURL
        self.market = market
        self.rpcURL = rpcURL
        self.marketAddresses = marketAddresses
        self.attester = attester
        if let existing = try? Wallet.load(store: keyStore) {
            wallet = existing
            walletAddress = existing.address
        }
    }

    /// True when the app is configured for account/login (#27) rather than the
    /// device-local-key onboarding.
    public var hasAccount: Bool { account != nil }

    public func chooseLauncherMode(_ mode: LauncherMode) {
        launcherMode = mode
        if mode != .mobileTrustCenter {
            mobileTrustCenterActive = false
        }
    }

    public func returnToLauncher() {
        mobileTrustCenterActive = false
        launcherMode = nil
    }

    public func startMobileTrustCenter() {
        launcherMode = .mobileTrustCenter
        mobileTrustCenterActive = true
    }

    public func stopMobileTrustCenter() {
        mobileTrustCenterActive = false
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

    /// Sign out: clear the in-memory wallet/session and reset UI state. The key
    /// remains in the KeyStore (Keychain) unless explicitly deleted; the login
    /// wall (#27) decrypts it back into memory on next sign-in.
    public func signOut() {
        wallet = nil
        walletAddress = nil
        walletKeyData = nil
        currentIdentity = nil
        launcherMode = nil
        mobileTrustCenterActive = false
        currentTriangle = nil
        claimHistory = []
        status = .idle
        if let account { Task { try? await account.logout() } }
    }

    @Published public private(set) var authError: String?

    public func clearAuthError() { authError = nil }

    /// Surface a UI-side validation message through the shared auth-error channel.
    public func reportAuthError(_ message: String) { authError = message }

    /// Load the wallet's owned slot NFTs (#29) into `ownedNfts`.
    public func loadOwnedNfts() async {
        guard let nft, let address = walletAddress else { ownedNfts = .empty; return }
        ownedNfts = .loading
        do {
            let tokens = try await nft.owned(address: address)
            ownedNfts = tokens.isEmpty ? .empty : .loaded(tokens)
        } catch {
            ownedNfts = .failed("Couldn't load your triangles. Pull to retry.")
        }
    }

    // MARK: marketplace (#30)

    /// Active marketplace listings.
    @Published public private(set) var listings: LoadPhase<[Listing]> = .idle
    /// Last marketplace action outcome, for the status banner.
    @Published public var marketStatus: String?

    /// True when trading (not just browsing) is wired: a wallet, an RPC endpoint,
    /// and deployed contract addresses are all present.
    public var canTrade: Bool { wallet != nil && rpcURL != nil && marketAddresses != nil }

    public func loadListings() async {
        guard let market else { listings = .empty; return }
        listings = .loading
        do {
            let all = try await market.listings()
            listings = all.isEmpty ? .empty : .loaded(all)
        } catch {
            listings = .failed("Couldn't load the marketplace. Pull to retry.")
        }
    }

    /// Run a state-changing marketplace action (already user-confirmed), refresh
    /// listings, and surface the outcome. Never auto-retries a sent tx.
    public func runMarketAction(_ action: @escaping (MarketplaceWriter) async throws -> String) async {
        guard let writer = makeWriter() else {
            marketStatus = "The marketplace isn't available on this network yet."
            return
        }
        marketStatus = "Submitting…"
        do {
            let txHash = try await action(writer)
            marketStatus = "Done — tx \(txHash.prefix(10))…"
            await loadListings()
        } catch let error as MarketplaceWriteError {
            marketStatus = error.userMessage
        } catch {
            marketStatus = "The transaction failed. Try again."
        }
    }

    private func makeWriter() -> MarketplaceWriter? {
        guard let wallet, let rpcURL, let marketAddresses else { return nil }
        return MarketplaceWriter(rpc: JsonRpcClient(url: rpcURL), addresses: marketAddresses, wallet: wallet)
    }

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
            Self.persistBackup(KeyBackup(identity: identity, blob: blob))
            try keyStore.save(walletKey)
            _ = try await account.login(identity: identity, authKey: blob.authKey)  // obtain session cookie
            adopt(walletKey: walletKey, identity: identity)
        } catch {
            authError = Self.authMessage(error)
        }
    }

    /// Login wall (#27) — sign in: derive authKey from the KDF salt, fetch the
    /// ciphertext, decrypt the wallet into the KeyStore. A fresh device first
    /// asks account-api for the non-secret KDF params, so normal password login
    /// works without a pre-existing local cache or key-file import.
    public func signIn(identity: String, password: String) async {
        guard let account else { return }
        authError = nil
        do {
            let kdf: KdfParams
            if let cached = Self.cachedKdf(for: identity) {
                kdf = cached
            } else {
                kdf = try await account.kdfParams(identity: identity)
                Self.cacheKdf(kdf, for: identity)
            }
            let authKey = try await Self.offMain { try AccountVault.deriveAuthKey(password: password, kdf: kdf) }
            let res = try await account.login(identity: identity, authKey: authKey)
            let key = try await Self.offMain {
                try AccountVault.decrypt(password: password, ciphertext: res.ciphertext, iv: res.iv, kdf: res.kdf)
            }
            try keyStore.save(key)
            Self.persistBackup(KeyBackup(
                identity: identity, address: res.address,
                vaultCiphertext: res.ciphertext, iv: res.iv, kdfParams: res.kdf
            ))
            adopt(walletKey: key, identity: identity)
        } catch {
            authError = Self.authMessage(error)
        }
    }

    private func adopt(walletKey: Data, identity: String) {
        if let w = try? Wallet(privateKeyData: walletKey) {
            wallet = w
            walletAddress = w.address
            walletKeyData = walletKey
            currentIdentity = identity.lowercased()
            status = .idle
        } else {
            authError = "Corrupted wallet key."
        }
    }

    // MARK: key backup (download / upload) + trusted device (Secure Enclave)

    private static func backupKey(_ identity: String) -> String { "step.backup.\(identity.lowercased())" }

    static func persistBackup(_ b: KeyBackup) {
        if let data = try? b.jsonData() { UserDefaults.standard.set(data, forKey: backupKey(b.identity)) }
    }

    static func loadPersistedBackup(_ identity: String) -> KeyBackup? {
        guard let data = UserDefaults.standard.data(forKey: backupKey(identity)) else { return nil }
        return try? KeyBackup.decode(data)
    }

    /// The signed-in identity, if any (used by the key-management UI).
    public var signedInIdentity: String? { currentIdentity }

    /// The downloadable encrypted key backup for the signed-in account (#key).
    public func exportableBackup() -> KeyBackup? {
        guard let id = currentIdentity else { return nil }
        return Self.loadPersistedBackup(id)
    }

    /// Restore/unlock the wallet from an uploaded key backup file + password.
    /// Decrypts entirely on-device — works on a fresh device (cross-device login).
    public func unlock(fromBackupData data: Data, password: String) async {
        authError = nil
        do {
            let backup = try KeyBackup.decode(data)
            let key = try await Self.offMain { try backup.unlock(password: password) }
            try keyStore.save(key)
            Self.cacheKdf(backup.kdfParams, for: backup.identity)
            Self.persistBackup(backup)
            adopt(walletKey: key, identity: backup.identity)
        } catch {
            authError = Self.authMessage(error)
        }
    }

    /// Whether this device has biometric hardware for trusted storage.
    public var biometricsAvailable: Bool { TrustedDeviceStore.biometricsAvailable }

    public func isDeviceTrusted(_ identity: String) -> Bool {
        TrustedDeviceStore.isTrusted(identity: identity)
    }

    /// Trust this device: store the wallet key in the Secure Enclave, gated by
    /// Face ID/Touch ID. Returns false (and sets authError) on failure.
    @discardableResult
    public func trustThisDevice() -> Bool {
        authError = nil
        let key: Data
        if let inMemoryKey = walletKeyData {
            key = inMemoryKey
        } else if let keyFromStore = (try? keyStore.load()) {
            key = keyFromStore
            walletKeyData = keyFromStore
        } else {
            authError = "Sign in first, then trust this device."
            return false
        }

        guard let id = currentIdentity else {
            authError = "Sign in first, then trust this device."
            return false
        }
        do {
            try TrustedDeviceStore.trust(identity: id, walletKey: key)
            authError = nil
            return true
        } catch {
            authError = Self.authMessage(error)
            return false
        }
    }

    public func forgetTrustedDevice() {
        if let id = currentIdentity {
            TrustedDeviceStore.forget(identity: id)
            authError = nil
        }
    }

    /// Load the wallet from this trusted device (prompts Face ID/Touch ID).
    public func unlockFromTrustedDevice(identity: String) async {
        authError = nil
        do {
            let key = try await Self.offMain {
                try TrustedDeviceStore.loadTrusted(identity: identity, reason: "Unlock your STEP wallet")
            }
            try keyStore.save(key)
            adopt(walletKey: key, identity: identity)
        } catch TrustedDeviceError.cancelled {
            // user cancelled the biometric prompt — no error
        } catch {
            authError = Self.authMessage(error)
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
        case TrustedDeviceError.biometricsUnavailable: return "Biometrics are unavailable. Enable Face ID/Touch ID in Settings and allow it for STEP."
        case TrustedDeviceError.notTrusted: return "This account has not been trusted on this device yet."
        case TrustedDeviceError.cancelled: return "Biometric unlock was cancelled."
        case TrustedDeviceError.keychain(let status):
            return "Secure key storage is unavailable (code: \(status)). Open Settings and retry with Face ID enabled."
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
    /// Submit a mining claim for the current triangle. Device attestation (#31)
    /// is produced by the configured `attester` and bound to the claim hash; on
    /// Simulator / unsupported devices it degrades to the honest unattested tier.
    public func mine(at sample: LocationSample) async {
        guard let wallet, let triangle = currentTriangle else {
            status = .error("wallet and triangle required")
            return
        }
        status = .submitting
        do {
            let nonce = try await client.requestNonce(wallet: wallet.address)
            let claim = try await ClaimBuilder.makeAttestedClaim(
                wallet: wallet,
                triangle: triangle,
                location: sample,
                nonce: nonce.nonce,
                attester: attester,
                anchorProofs: capturedAnchor.map { [$0] }
            )
            status = .validating
            let record = try await client.submit(claim: claim)
            capturedAnchor = nil // never replay an anchor proof across claims
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
