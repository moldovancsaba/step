// Trusted-device key storage (the on-device "treasure/vault"). On a device the
// user chooses to trust, the wallet key is stored in the Keychain protected by
// the Secure Enclave's access control: it requires the current biometric set
// (Face ID / Touch ID) AND device unlock, and never leaves this device
// (`...ThisDeviceOnly`). A trusted device can then auto-load the key after a
// biometric prompt — no key-backup file needed — while the key is extractable
// only via that device's secure hardware + the user's biometric.
//
// NOTE: Apple does not expose IMEI / MAC / serial to apps (privacy). The Secure
// Enclave + biometrics is the sanctioned hardware trust anchor; device
// genuineness is additionally proven by App Attest (#31) and identifierForVendor.
import Foundation
import Security
#if canImport(LocalAuthentication)
import LocalAuthentication
#endif

public enum TrustedDeviceError: Error, Sendable, Equatable {
    case biometricsUnavailable
    case notTrusted
    case cancelled
    case keychain(OSStatus)
}

public enum TrustedDeviceStore {
    private static let service = "app.step.wallet.trusted"
    private static func account(_ identity: String) -> String { identity.lowercased() }
    private static func marker(_ identity: String) -> String { "step.trusted.\(identity.lowercased())" }

    /// Whether this device has usable biometric hardware enrolled.
    public static var biometricsAvailable: Bool {
        #if canImport(LocalAuthentication)
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        #else
        return false
        #endif
    }

    /// Cheap check (no biometric prompt) of whether this device is trusted.
    public static func isTrusted(identity: String) -> Bool {
        UserDefaults.standard.bool(forKey: marker(identity))
    }

    /// Store the wallet key bound to this device, gated by biometrics + device
    /// unlock. Replaces any prior trusted key for the identity.
    public static func trust(identity: String, walletKey: Data) throws {
        forget(identity: identity)
        guard biometricsAvailable else { throw TrustedDeviceError.biometricsUnavailable }
        var cfError: Unmanaged<CFError>?
        guard
            let access = SecAccessControlCreateWithFlags(
                nil,
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                .biometryCurrentSet,
                &cfError
            )
        else { throw TrustedDeviceError.biometricsUnavailable }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(identity),
            kSecValueData as String: walletKey,
            kSecAttrAccessControl as String: access,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw TrustedDeviceError.keychain(status) }
        UserDefaults.standard.set(true, forKey: marker(identity))
    }

    /// Load the trusted wallet key, prompting Face ID / Touch ID.
    public static func loadTrusted(identity: String, reason: String) throws -> Data {
        guard isTrusted(identity: identity) else { throw TrustedDeviceError.notTrusted }
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(identity),
            kSecReturnData as String: true,
        ]
        #if canImport(LocalAuthentication)
        let ctx = LAContext()
        ctx.localizedReason = reason
        query[kSecUseAuthenticationContext as String] = ctx
        #endif
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecUserCanceled { throw TrustedDeviceError.cancelled }
        guard status == errSecSuccess, let data = out as? Data else {
            throw TrustedDeviceError.keychain(status)
        }
        return data
    }

    /// Remove the trusted key for this identity from the device.
    public static func forget(identity: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(identity),
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: marker(identity))
    }
}
