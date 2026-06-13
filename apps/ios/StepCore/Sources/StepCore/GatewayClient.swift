// Networking to the alpha gateway and the canonical mesh API (DEV §6.2
// Core/Networking + Core/Mesh). URLSession only; the app never claims final
// validity — it submits evidence and tracks status (DEV §6.4).
import Foundation

public struct TriangleInfo: Codable, Sendable {
    public let triangleId: String
    public let triangleIdHash: String
    public let level: Int
    public let vertices: [Vertex]
    public let centroid: Vertex
    public let areaM2: Double
    public let minSideM: Double
    public let parent: String?
    public let neighbours: [String]

    public struct Vertex: Codable, Sendable {
        public let lat: Double
        public let lon: Double
    }

    enum CodingKeys: String, CodingKey {
        case triangleId = "triangle_id"
        case triangleIdHash = "triangle_id_hash"
        case level
        case vertices
        case centroid
        case areaM2 = "area_m2"
        case minSideM = "min_side_m"
        case parent
        case neighbours
    }
}

public struct ClaimRecord: Codable, Sendable {
    public let claimHash: String
    public let status: String // submitted|validating|accepted|finalised|rejected
    public let rejectReasons: [String]
    public let txHash: String?

    enum CodingKeys: String, CodingKey {
        case claimHash = "claim_hash"
        case status
        case rejectReasons = "reject_reasons"
        case txHash = "tx_hash"
    }
}

public enum GatewayError: Error, LocalizedError {
    case http(Int, String)
    case decoding

    public var errorDescription: String? {
        switch self {
        case .http(let code, let body): return "gateway HTTP \(code): \(body)"
        case .decoding: return "unexpected gateway response"
        }
    }
}

public struct GatewayClient: Sendable {
    public let gatewayURL: URL
    public let meshURL: URL
    let session: URLSession

    public init(gatewayURL: URL, meshURL: URL, session: URLSession = .shared) {
        self.gatewayURL = gatewayURL
        self.meshURL = meshURL
        self.session = session
    }

    func post<T: Decodable>(_ url: URL, body: [String: Any]) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func get<T: Decodable>(_ url: URL) async throws -> T {
        let (data, response) = try await session.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    public struct NonceResponse: Codable, Sendable {
        public let nonce: String
        public let expiresAtUnix: Int
        enum CodingKeys: String, CodingKey {
            case nonce
            case expiresAtUnix = "expires_at_unix"
        }
    }

    public func requestNonce(wallet: String) async throws -> NonceResponse {
        try await post(gatewayURL.appendingPathComponent("v1/nonce"), body: ["wallet": wallet])
    }

    public func submit(claim: Claim) async throws -> ClaimRecord {
        let encoder = JSONEncoder()
        let claimJSON = try JSONSerialization.jsonObject(with: encoder.encode(claim))
        return try await post(gatewayURL.appendingPathComponent("v1/claims"), body: ["claim": claimJSON])
    }

    public func claimStatus(hash: String) async throws -> ClaimRecord {
        try await get(gatewayURL.appendingPathComponent("v1/claims/\(hash)"))
    }

    public func resolveTriangle(lat: Double, lon: Double, level: Int) async throws -> TriangleInfo {
        var components = URLComponents(
            url: meshURL.appendingPathComponent("v1/mesh/resolve"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            .init(name: "lat", value: String(lat)),
            .init(name: "lon", value: String(lon)),
            .init(name: "level", value: String(level)),
        ]
        return try await get(components.url!)
    }
}
