// Zero-knowledge wallet vault for iOS (M7 #27), byte-compatible with
// services/account-api (#12). The password never leaves the device: Argon2id
// derives 64 bytes split into authKey (first 32, sent as the server verifier
// input) and wrapKey (last 32, never sent). The wallet's 32-byte secp256k1 key
// is AES-256-GCM-encrypted under wrapKey. The server stores only the Argon2id
// verifier + opaque ciphertext + public address + KDF/IV.
//
// Cross-impl parity: Argon2id (RFC 9106 v0x13, via Argon2Swift) and AES-256-GCM
// (CryptoKit) produce identical bytes to account-api's @noble/hashes argon2id +
// @noble/ciphers gcm for the same params — so a vault written on the web
// decrypts on iOS with the same password (and vice-versa). @noble's GCM output
// is `ciphertext || tag`; CryptoKit splits them, so we concatenate on seal and
// split on open.
import Foundation
import CryptoKit
import Argon2Swift

public struct KdfParams: Codable, Equatable, Sendable {
    public let algo: String   // "argon2id"
    public let m: Int         // memory cost (KiB)
    public let t: Int         // time cost (iterations)
    public let p: Int         // parallelism
    public let salt: String   // base64

    public init(m: Int, t: Int, p: Int, salt: String, algo: String = "argon2id") {
        self.algo = algo; self.m = m; self.t = t; self.p = p; self.salt = salt
    }
}

public struct VaultBlob: Sendable {
    public let ciphertext: String   // base64 (AES-GCM ciphertext || tag)
    public let iv: String           // base64 (12-byte nonce)
    public let kdf: KdfParams
    public let authKey: String      // base64 (sent to the server)
    public let address: String      // 0x… public address
}

public enum VaultError: Error, Equatable, Sendable {
    case kdf
    case decrypt          // wrong password or corrupted vault (GCM tag mismatch)
    case badBase64
}

/// Client KDF cost defaults (mirror account-api / the web client). Tuned for an
/// interactive on-device login; the server adds a second Argon2id pass (#14).
public enum VaultDefaults {
    public static let m = 19_456
    public static let t = 2
    public static let p = 1
    public static let dkLen = 64
}

public enum AccountVault {
    /// Derive (authKey, wrapKey) from a password + salt via Argon2id.
    public static func deriveKeys(
        password: String, salt: Data, m: Int, t: Int, p: Int
    ) throws -> (authKey: Data, wrapKey: Data) {
        let result: Argon2SwiftResult
        do {
            result = try Argon2Swift.hashPasswordBytes(
                password: Data(password.utf8),
                salt: Salt(bytes: salt),
                iterations: t,
                memory: m,
                parallelism: p,
                length: VaultDefaults.dkLen,
                type: .id,
                version: .V13
            )
        } catch { throw VaultError.kdf }
        let dk = result.hashData()
        guard dk.count == VaultDefaults.dkLen else { throw VaultError.kdf }
        return (dk.prefix(32), dk.suffix(32))
    }

    /// Encrypt a 32-byte wallet key into a server-storable vault blob.
    public static func encrypt(password: String, walletKey: Data) throws -> VaultBlob {
        let salt = randomBytes(16)
        let iv = randomBytes(12)
        let (authKey, wrapKey) = try deriveKeys(
            password: password, salt: salt, m: VaultDefaults.m, t: VaultDefaults.t, p: VaultDefaults.p
        )
        let sealed = try AES.GCM.seal(
            walletKey, using: SymmetricKey(data: wrapKey), nonce: try AES.GCM.Nonce(data: iv)
        )
        let ctTag = sealed.ciphertext + sealed.tag       // @noble layout: ct || tag
        let address = try Wallet(privateKeyData: walletKey).address
        return VaultBlob(
            ciphertext: ctTag.base64EncodedString(),
            iv: iv.base64EncodedString(),
            kdf: KdfParams(m: VaultDefaults.m, t: VaultDefaults.t, p: VaultDefaults.p, salt: salt.base64EncodedString()),
            authKey: authKey.base64EncodedString(),
            address: address
        )
    }

    /// Decrypt a vault blob back to the 32-byte wallet key.
    public static func decrypt(
        password: String, ciphertext: String, iv: String, kdf: KdfParams
    ) throws -> Data {
        guard let saltData = Data(base64Encoded: kdf.salt),
              let ivData = Data(base64Encoded: iv),
              let ctTag = Data(base64Encoded: ciphertext), ctTag.count > 16
        else { throw VaultError.badBase64 }
        let (_, wrapKey) = try deriveKeys(
            password: password, salt: saltData, m: kdf.m, t: kdf.t, p: kdf.p
        )
        let body = ctTag.prefix(ctTag.count - 16)
        let tag = ctTag.suffix(16)
        do {
            let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: ivData), ciphertext: body, tag: tag)
            return try AES.GCM.open(box, using: SymmetricKey(data: wrapKey))
        } catch { throw VaultError.decrypt }
    }

    /// Re-derive only the authKey for login (no wallet decrypt needed yet).
    public static func deriveAuthKey(password: String, kdf: KdfParams) throws -> String {
        guard let saltData = Data(base64Encoded: kdf.salt) else { throw VaultError.badBase64 }
        return try deriveKeys(password: password, salt: saltData, m: kdf.m, t: kdf.t, p: kdf.p)
            .authKey.base64EncodedString()
    }

    public static func randomBytes(_ n: Int) -> Data {
        var b = Data(count: n)
        _ = b.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, n, $0.baseAddress!) }
        return b
    }
}
