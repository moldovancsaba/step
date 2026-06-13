// Embedded self-custodial wallet (ADR-012, DEV §6.2 Core/Wallet).
//
// Key custody: the secp256k1 signing key is generated on device and persisted
// through a `KeyStore`. The app uses `KeychainKeyStore` (biometry-protected;
// the Secure Enclave cannot host secp256k1 directly — documented constraint,
// ADR-012); tests use `InMemoryKeyStore`. Export/import is hex of the 32-byte
// scalar, shown once behind an explicit user action.
import Foundation
import secp256k1

public protocol KeyStore: Sendable {
    func load() throws -> Data?
    func save(_ key: Data) throws
    func delete() throws
}

public final class InMemoryKeyStore: KeyStore, @unchecked Sendable {
    private var stored: Data?
    public init() {}
    public func load() throws -> Data? { stored }
    public func save(_ key: Data) throws { stored = key }
    public func delete() throws { stored = nil }
}

#if canImport(Security)
import Security

/// Keychain-backed store used by the app (kSecAttrAccessibleWhenUnlocked,
/// ThisDeviceOnly: keys never enter iCloud backups).
public struct KeychainKeyStore: KeyStore {
    let service = "earth.step.miner.wallet"
    let account = "primary"
    public init() {}

    public func load() throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw WalletError.keychain(status)
        }
        return data
    }

    public func save(_ key: Data) throws {
        try? delete()
        let attrs: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: key,
        ]
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else { throw WalletError.keychain(status) }
    }

    public func delete() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
#endif

public enum WalletError: Error {
    case noKey
    case invalidKey
    case keychain(Int32)
}

public struct Wallet: @unchecked Sendable {
    private let privateKey: secp256k1.Recovery.PrivateKey
    public let address: String

    public init(privateKeyData: Data) throws {
        guard privateKeyData.count == 32 else { throw WalletError.invalidKey }
        privateKey = try secp256k1.Recovery.PrivateKey(
            dataRepresentation: privateKeyData, format: .uncompressed
        )
        address = Wallet.deriveAddress(publicKey: privateKey.publicKey)
    }

    public static func create(store: KeyStore) throws -> Wallet {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, 32, &bytes) == errSecSuccess else {
            throw WalletError.invalidKey
        }
        let data = Data(bytes)
        try store.save(data)
        return try Wallet(privateKeyData: data)
    }

    public static func load(store: KeyStore) throws -> Wallet {
        guard let data = try store.load() else { throw WalletError.noKey }
        return try Wallet(privateKeyData: data)
    }

    static func deriveAddress(publicKey: secp256k1.Recovery.PublicKey) -> String {
        // keccak256 of the 64-byte uncompressed point (without the 0x04
        // prefix), last 20 bytes — standard Ethereum address derivation.
        let uncompressed = publicKey.dataRepresentation // 65 bytes (.uncompressed format)
        let digest = Keccak.hash256(uncompressed.dropFirst())
        return Data(digest.suffix(20)).hexString
    }

    /// Ethereum-style 65-byte r||s||v signature (v ∈ {27,28}) over a 32-byte
    /// digest — identical wire format to the Rust and TS implementations
    /// (RFC-6979 deterministic, so identical bytes too).
    public func sign(digest: Data) throws -> Data {
        let signature = try privateKey.signature(for: HashDigest([UInt8](digest)))
        let compact = try signature.compactRepresentation
        var out = compact.signature // r||s, 64 bytes
        out.append(UInt8(27 + compact.recoveryId))
        return out
    }

    /// Signs a claim in place (EIP-191 over the canonical message).
    public func sign(claim: inout Claim) throws {
        claim.signature = try sign(digest: claim.personalDigest).hexString
    }
}
