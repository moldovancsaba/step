// Marketplace read model (M7 #30). Browses active triangle-slot-NFT listings
// and trade history from the marketplace indexer (#10). Write/trade actions are
// in MarketplaceWriter (on-chain TriangleMarketplace #8). Trinity has no
// monetary value (testnet) — prices are integer Trinity (indivisible).
import Foundation

public struct Listing: Codable, Sendable, Equatable, Identifiable {
    public let tokenId: String
    public let seller: String
    public let priceTrinity: String  // uint256 decimal string
    public let active: Bool
    public let listedAtBlock: String
    public var id: String { tokenId }
    enum CodingKeys: String, CodingKey {
        case tokenId = "token_id"
        case seller
        case priceTrinity = "price_trinity"
        case active
        case listedAtBlock = "listed_at_block"
    }
}

public struct Trade: Codable, Sendable, Equatable, Identifiable {
    public let kind: String        // sale | gift | list | cancel
    public let tokenId: String
    public let from: String?
    public let to: String?
    public let priceTrinity: String?
    public let blockNumber: String
    public let txHash: String
    public var id: String { "\(txHash)-\(kind)-\(tokenId)" }
    enum CodingKeys: String, CodingKey {
        case kind
        case tokenId = "token_id"
        case from, to
        case priceTrinity = "price_trinity"
        case blockNumber = "block_number"
        case txHash = "tx_hash"
    }
}

/// Read-only marketplace browsing via the nft-indexer (#10).
public struct MarketplaceClient: Sendable {
    let baseURL: URL
    let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Active listings (`GET /v1/listings`).
    public func listings() async throws -> [Listing] {
        try await get([Listing].self, path: "v1/listings")
    }

    /// Trade history for a token, newest last (`GET /v1/tokens/{id}/trades`).
    public func trades(tokenId: String) async throws -> [Trade] {
        try await get([Trade].self, path: "v1/tokens/\(tokenId)/trades")
    }

    private func get<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        let (data, response) = try await session.data(from: baseURL.appendingPathComponent(path))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
