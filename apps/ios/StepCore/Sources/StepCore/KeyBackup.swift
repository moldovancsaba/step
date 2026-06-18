// Self-custody key backup — the cross-platform "download your key" format,
// byte-for-byte compatible with the web app's `step.keybackup.v1` JSON (a backup
// downloaded on the web restores on iOS and vice-versa). It is the zero-knowledge
// encrypted vault: identity + public address + the AES-GCM vault ciphertext +
// KDF/IV params. No plaintext key — only the password unlocks it. The key is the
// authentication layer to the wallet (see the two-layer login model).
import Foundation

public struct KeyBackup: Codable, Sendable, Equatable {
    public let format: String
    public let identity: String
    public let address: String
    public let vaultCiphertext: String
    public let iv: String
    public let kdfParams: KdfParams

    public static let currentFormat = "step.keybackup.v1"

    enum CodingKeys: String, CodingKey {
        case format, identity, address, iv
        case vaultCiphertext = "vault_ciphertext"
        case kdfParams = "kdf_params"
    }

    public init(identity: String, address: String, vaultCiphertext: String, iv: String, kdfParams: KdfParams) {
        self.format = Self.currentFormat
        self.identity = identity.lowercased()
        self.address = address
        self.vaultCiphertext = vaultCiphertext
        self.iv = iv
        self.kdfParams = kdfParams
    }

    /// Build a backup from a freshly-encrypted vault (or a login response).
    public init(identity: String, blob: VaultBlob) {
        self.init(
            identity: identity, address: blob.address,
            vaultCiphertext: blob.ciphertext, iv: blob.iv, kdfParams: blob.kdf
        )
    }

    /// Encode to pretty JSON for export (the downloaded file).
    public func jsonData() throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try enc.encode(self)
    }

    /// Suggested filename, matching the web (`step-key-<address>.json`).
    public var suggestedFileName: String { "step-key-\(address).json" }

    /// Parse + validate an uploaded backup file.
    public static func decode(_ data: Data) throws -> KeyBackup {
        let b = try JSONDecoder().decode(KeyBackup.self, from: data)
        guard b.format == currentFormat else { throw KeyBackupError.unsupportedFormat }
        return b
    }

    /// Decrypt the wallet key with the password, verifying the address matches.
    /// This is the deliberate "authorize the wallet with your key" step.
    public func unlock(password: String) throws -> Data {
        let key = try AccountVault.decrypt(
            password: password, ciphertext: vaultCiphertext, iv: iv, kdf: kdfParams
        )
        let derived = try Wallet(privateKeyData: key).address
        guard derived.lowercased() == address.lowercased() else { throw KeyBackupError.addressMismatch }
        return key
    }
}

public enum KeyBackupError: Error, Equatable, Sendable {
    case unsupportedFormat
    case addressMismatch
}
