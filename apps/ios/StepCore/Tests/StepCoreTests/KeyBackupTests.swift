import Foundation
import Testing

@testable import StepCore

/// The key-backup file (`step.keybackup.v1`) is the cross-device "download your
/// key" format shared with the web app. These tests pin its JSON shape and the
/// unlock semantics (password decrypts; address must match), and prove a backup
/// built from the account-api/web vector opens on iOS.
@Suite struct KeyBackupTests {
    // Same account-api (@noble) parity vector as AccountVaultTests.
    let password = "pilot-parity-pass-123"
    let saltB64 = "BwcHBwcHBwcHBwcHBwcHBw=="
    let ivB64 = "CQkJCQkJCQkJCQkJ"
    let ctB64 = "ik0kg57NvE+fnQYOquWdaJUPvRplhtEmsYk5LKLMsDwOXoCB3INh5Iz2kAeBRQcm"
    let walletKey = Data(repeating: 0x42, count: 32)

    private var kdf: KdfParams { KdfParams(m: 8192, t: 2, p: 1, salt: saltB64) }
    private var address: String { (try? Wallet(privateKeyData: walletKey).address) ?? "" }

    private func vectorBackup() -> KeyBackup {
        KeyBackup(identity: "Pilot@Example.com", address: address,
                  vaultCiphertext: ctB64, iv: ivB64, kdfParams: kdf)
    }

    @Test func encodeUsesWebCompatibleSnakeCaseShape() throws {
        let json = try vectorBackup().jsonData()
        let obj = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        #expect(obj["format"] as? String == "step.keybackup.v1")
        #expect(obj["identity"] as? String == "pilot@example.com")  // normalised
        #expect(obj["vault_ciphertext"] as? String == ctB64)
        #expect(obj["iv"] as? String == ivB64)
        let kp = obj["kdf_params"] as! [String: Any]
        #expect(kp["salt"] as? String == saltB64)
    }

    @Test func roundTripsThroughJSON() throws {
        let data = try vectorBackup().jsonData()
        let decoded = try KeyBackup.decode(data)
        #expect(decoded == vectorBackup())
    }

    @Test func unlockWithPasswordRecoversWalletKey() throws {
        let key = try vectorBackup().unlock(password: password)
        #expect(key == walletKey)
    }

    @Test func unlockWithWrongPasswordThrows() throws {
        var threw = false
        do { _ = try vectorBackup().unlock(password: "nope-nope-nope") } catch { threw = true }
        #expect(threw)
    }

    @Test func decodeRejectsUnknownFormat() throws {
        let bad = #"{"format":"step.keybackup.v999","identity":"a","address":"0x0","vault_ciphertext":"x","iv":"y","kdf_params":{"algo":"argon2id","m":8192,"t":2,"p":1,"salt":"z"}}"#
        var caught: KeyBackupError?
        do { _ = try KeyBackup.decode(Data(bad.utf8)) } catch let e as KeyBackupError { caught = e }
        #expect(caught == .unsupportedFormat)
    }

    @Test func unlockRejectsAddressMismatch() throws {
        let tampered = KeyBackup(identity: "x", address: "0xdeadbeef00000000000000000000000000000000",
                                 vaultCiphertext: ctB64, iv: ivB64, kdfParams: kdf)
        var caught: KeyBackupError?
        do { _ = try tampered.unlock(password: password) } catch let e as KeyBackupError { caught = e }
        #expect(caught == .addressMismatch)
    }

    @Test func suggestedFileNameMatchesWeb() {
        #expect(vectorBackup().suggestedFileName == "step-key-\(address).json")
    }
}
