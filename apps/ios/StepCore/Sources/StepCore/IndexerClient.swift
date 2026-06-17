// Read-only client for the indexer projection: triangle mining state for the
// v2 current-mineable-triangle resolution (see MineableResolver). Uses the
// indexer's GET /v1/mesh-states/{idHash}, which always returns 200 — an unmined
// triangle reports usedSlots 0 (a full oasis).
import Foundation

public struct IndexerClient: Sendable, TriangleStateProviding {
    public let indexerURL: URL
    let session: URLSession

    public init(indexerURL: URL, session: URLSession = .shared) {
        self.indexerURL = indexerURL
        self.session = session
    }

    private struct MeshStateResponse: Decodable {
        let usedSlots: Int
        let totalSlots: Int
        let frozen: Bool
        enum CodingKeys: String, CodingKey {
            case usedSlots = "used_slots"
            case totalSlots = "total_slots"
            case frozen
        }
    }

    public func triangleState(triangleIdHash: String) async throws -> TriangleState {
        let url = indexerURL.appendingPathComponent("v1/mesh-states/\(triangleIdHash)")
        let (data, response) = try await session.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        let r = try JSONDecoder().decode(MeshStateResponse.self, from: data)
        return TriangleState(usedSlots: r.usedSlots, totalSlots: r.totalSlots, frozen: r.frozen)
    }
}

/// The gateway/validator mesh API already resolves coordinates to triangles;
/// expose it as the resolver the MineableResolver depends on.
extension GatewayClient: TriangleResolving {}
