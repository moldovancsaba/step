// Transport for services/account-api (#12). Carries the session cookie via
// URLSession's cookie store. Never logs authKey/ciphertext/password. Used by
// the login wall (#27): register → login → decrypt vault → in-memory wallet.
import Foundation

public enum AccountError: Error, Equatable, Sendable {
    case identityTaken
    case invalidCredentials
    case validation
    case http(Int, String)
}

public struct AccountClient: Sendable {
    public let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public struct LoginResult: Decodable, Sendable {
        public let ciphertext: String
        public let iv: String
        public let kdf: KdfParams
        public let address: String
        enum CodingKeys: String, CodingKey {
            case ciphertext = "vault_ciphertext"
            case iv
            case kdf = "kdf_params"
            case address
        }
    }

    public struct Session: Decodable, Sendable {
        public let identity: String
        public let address: String
    }

    private struct KdfLookupResult: Decodable {
        let kdf: KdfParams

        enum CodingKeys: String, CodingKey {
            case kdf = "kdf_params"
        }
    }

    /// Fetch the non-secret KDF parameters for an identity before login. The
    /// account-api returns real params for existing identities and stable decoy
    /// params for unknown identities, so this does not expose account existence.
    public func kdfParams(identity: String) async throws -> KdfParams {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/kdf"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "identity", value: identity)]
        guard let url = components?.url else { throw AccountError.validation }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200: return try JSONDecoder().decode(KdfLookupResult.self, from: data).kdf
        case 400: throw AccountError.validation
        default: throw AccountError.http(status, "kdf")
        }
    }

    /// Register a new account from a fully-formed vault blob (#27 derives it).
    public func register(identity: String, blob: VaultBlob) async throws {
        let body: [String: Any] = [
            "identity": identity,
            "authKey": blob.authKey,
            "address": blob.address,
            "vault_ciphertext": blob.ciphertext,
            "iv": blob.iv,
            "kdf_params": ["algo": blob.kdf.algo, "m": blob.kdf.m, "t": blob.kdf.t, "p": blob.kdf.p, "salt": blob.kdf.salt],
        ]
        let (_, status) = try await send("v1/register", body: body)
        switch status {
        case 201: return
        case 409: throw AccountError.identityTaken
        case 400: throw AccountError.validation
        default: throw AccountError.http(status, "register")
        }
    }

    /// Authenticate; returns the vault ciphertext + KDF params for client decrypt.
    public func login(identity: String, authKey: String) async throws -> LoginResult {
        let (data, status) = try await send("v1/login", body: ["identity": identity, "authKey": authKey])
        switch status {
        case 200: return try JSONDecoder().decode(LoginResult.self, from: data)
        case 401: throw AccountError.invalidCredentials
        default: throw AccountError.http(status, "login")
        }
    }

    public func logout() async throws {
        _ = try await send("v1/logout", body: [:])
    }

    public func session() async throws -> Session? {
        var req = URLRequest(url: baseURL.appendingPathComponent("v1/session"))
        req.httpMethod = "GET"
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { return nil }
        guard status == 200 else { throw AccountError.http(status, "session") }
        return try JSONDecoder().decode(Session.self, from: data)
    }

    /// Rotate the stored ciphertext/iv (e.g. password-change re-wrap), auth required.
    public func updateVault(ciphertext: String, iv: String) async throws {
        let (_, status) = try await send("v1/vault", method: "PUT", body: ["vault_ciphertext": ciphertext, "iv": iv])
        guard status == 200 else { throw AccountError.http(status, "vault") }
    }

    private func send(_ path: String, method: String = "POST", body: [String: Any]) async throws -> (Data, Int) {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = body.isEmpty ? Data("{}".utf8) : try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
