import Foundation
import Testing

@testable import StepCore

/// Cross-implementation parity with services/account-api (#12/#27): the vector
/// below was produced by the account-api crypto (@noble/hashes argon2id +
/// @noble/ciphers AES-256-GCM). The iOS AccountVault (Argon2Swift + CryptoKit)
/// MUST derive the same authKey and decrypt the same ciphertext to the same
/// wallet key — proving a vault written on the web opens on iOS (and vice-versa).
@Suite struct AccountVaultTests {
    // Fixed inputs the vector was generated from.
    let password = "pilot-parity-pass-123" // gitleaks:allow — cross-impl test vector, not a real secret
    let saltB64 = "BwcHBwcHBwcHBwcHBwcHBw=="
    let ivB64 = "CQkJCQkJCQkJCQkJ"
    let m = 8192, t = 2, p = 1
    let expectedAuthKeyB64 = "8LUcmmWVXX5hHQCzp4C2Gv6SLmwi9sRQZpOer5RfdLg=" // gitleaks:allow — test vector
    let ctB64 = "ik0kg57NvE+fnQYOquWdaJUPvRplhtEmsYk5LKLMsDwOXoCB3INh5Iz2kAeBRQcm"
    let walletKey = Data(repeating: 0x42, count: 32)

    private var kdf: KdfParams { KdfParams(m: m, t: t, p: p, salt: saltB64) }

    @Test func argon2idAuthKeyMatchesNoble() throws {
        let salt = Data(base64Encoded: saltB64)!
        let keys = try AccountVault.deriveKeys(password: password, salt: salt, m: m, t: t, p: p)
        #expect(keys.authKey.base64EncodedString() == expectedAuthKeyB64)
    }

    @Test func decryptsNobleCiphertextToSameWalletKey() throws {
        let key = try AccountVault.decrypt(password: password, ciphertext: ctB64, iv: ivB64, kdf: kdf)
        #expect(key == walletKey)
    }

    @Test func deriveAuthKeyParity() throws {
        #expect(try AccountVault.deriveAuthKey(password: password, kdf: kdf) == expectedAuthKeyB64)
    }

    @Test func encryptDecryptRoundTripSameAddress() throws {
        // A fresh, valid secp256k1 key encrypted + decrypted on iOS must recover.
        let original = Data(repeating: 0x11, count: 32)
        let blob = try AccountVault.encrypt(password: "another-strong-pass", walletKey: original)
        let recovered = try AccountVault.decrypt(
            password: "another-strong-pass", ciphertext: blob.ciphertext, iv: blob.iv, kdf: blob.kdf
        )
        #expect(recovered == original)
        #expect(try Wallet(privateKeyData: recovered).address == blob.address)
    }

    @Test func wrongPasswordFailsDecrypt() throws {
        var threw = false
        do {
            _ = try AccountVault.decrypt(password: "WRONG-pass-WRONG", ciphertext: ctB64, iv: ivB64, kdf: kdf)
        } catch { threw = true }
        #expect(threw)
    }
}
