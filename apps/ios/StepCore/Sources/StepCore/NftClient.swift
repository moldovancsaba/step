// Read-only client for the nft-indexer (#7): the slot NFTs a wallet owns, with
// provenance. Used by the Wallet tab (#29). No coordinates (PRV-001); ownership
// and provenance are public chain projections.
import Foundation

public struct NftToken: Codable, Identifiable, Sendable, Equatable {
    public let tokenId: String
    public let triangleIdHash: String
    public let level: Int
    public let slot: Int
    public let originalMiner: String
    public let mintedAt: Int
    public let owner: String

    public var id: String { tokenId }
    /// Slot 0 is the "landlord" of its triangle (campaign rights, #9).
    public var isLandlord: Bool { slot == 0 }
    /// 1-indexed mining order (slot 0 = first miner).
    public var miningOrder: Int { slot + 1 }

    enum CodingKeys: String, CodingKey {
        case tokenId = "token_id"
        case triangleIdHash = "triangle_id_hash"
        case level
        case slot
        case originalMiner = "original_miner"
        case mintedAt = "minted_at"
        case owner
    }
}

public struct NftClient: Sendable {
    public let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    private struct OwnerResponse: Decodable { let tokens: [NftToken] }

    /// Slot NFTs currently owned by `address`.
    public func owned(address: String) async throws -> [NftToken] {
        let url = baseURL.appendingPathComponent("v1/owners/\(address)")
        let (data, response) = try await session.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(OwnerResponse.self, from: data).tokens
    }
}
