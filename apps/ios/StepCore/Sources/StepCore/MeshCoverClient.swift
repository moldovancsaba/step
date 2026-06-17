// Viewport coverage + depletion for the oasis/desert map (#28). Fetches the
// validator's /v1/mesh/cover (#15) and the indexer's batch /v1/mesh-states (#16)
// and stitches them into coloured triangles. Transport types are UI-free (plain
// structs) so StepCore stays free of MapKit; the MapView converts to MapKit.
import Foundation

public struct MeshPoint: Codable, Sendable, Equatable {
    public let lat: Double
    public let lon: Double
}

public struct CoverTriangle: Codable, Sendable, Equatable, Identifiable {
    public let triangleId: String
    public let triangleIdHash: String
    public let vertices: [MeshPoint]
    public var id: String { triangleId }
    enum CodingKeys: String, CodingKey {
        case triangleId = "triangle_id"
        case triangleIdHash = "triangle_id_hash"
        case vertices
    }
}

public struct CoverResult: Codable, Sendable, Equatable {
    public let triangles: [CoverTriangle]
    public let truncated: Bool
    public let suggestedLevel: Int
    enum CodingKeys: String, CodingKey {
        case triangles
        case truncated
        case suggestedLevel = "suggested_level"
    }
}

public struct MeshDepletion: Codable, Sendable, Equatable {
    public let triangleIdHash: String
    public let usedSlots: Int
    public let totalSlots: Int
    public let depletion: Double
    public let state: String      // oasis | filling | desert
    public let frozen: Bool
    enum CodingKeys: String, CodingKey {
        case triangleIdHash = "triangle_id_hash"
        case usedSlots = "used_slots"
        case totalSlots = "total_slots"
        case depletion, state, frozen
    }
}

/// A cover triangle joined with its depletion (ready to colour).
public struct MeshOverlayTriangle: Sendable, Identifiable, Equatable {
    public let triangle: CoverTriangle
    public let depletion: MeshDepletion?
    public var id: String { triangle.triangleId }
    public var depletionRatio: Double { depletion?.depletion ?? 0 }
    public var stateLabel: String { depletion?.state ?? "oasis" }
}

public struct MeshCoverClient: Sendable {
    public let meshURL: URL      // validator / gateway mesh API
    public let indexerURL: URL
    let session: URLSession

    public init(meshURL: URL, indexerURL: URL, session: URLSession = .shared) {
        self.meshURL = meshURL
        self.indexerURL = indexerURL
        self.session = session
    }

    /// Cover the bbox at `level`, then fetch depletion for the hashes, returning
    /// overlay triangles. `truncated` means "zoom in / use suggestedLevel".
    public func overlay(
        minLat: Double, minLon: Double, maxLat: Double, maxLon: Double,
        level: Int, max: Int = 2000
    ) async throws -> (triangles: [MeshOverlayTriangle], truncated: Bool, suggestedLevel: Int) {
        let cover = try await self.cover(minLat: minLat, minLon: minLon, maxLat: maxLat, maxLon: maxLon, level: level, max: max)
        if cover.truncated { return ([], true, cover.suggestedLevel) }
        let states = try await self.states(hashes: cover.triangles.map(\.triangleIdHash))
        let byHash = Dictionary(uniqueKeysWithValues: states.map { ($0.triangleIdHash.lowercased(), $0) })
        let overlay = cover.triangles.map {
            MeshOverlayTriangle(triangle: $0, depletion: byHash[$0.triangleIdHash.lowercased()])
        }
        return (overlay, false, level)
    }

    func cover(minLat: Double, minLon: Double, maxLat: Double, maxLon: Double, level: Int, max: Int) async throws -> CoverResult {
        var comps = URLComponents(url: meshURL.appendingPathComponent("v1/mesh/cover"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            .init(name: "minLat", value: String(minLat)), .init(name: "minLon", value: String(minLon)),
            .init(name: "maxLat", value: String(maxLat)), .init(name: "maxLon", value: String(maxLon)),
            .init(name: "level", value: String(level)), .init(name: "max", value: String(max)),
        ]
        let (data, response) = try await session.data(from: comps.url!)
        try Self.ok(response, data)
        return try JSONDecoder().decode(CoverResult.self, from: data)
    }

    func states(hashes: [String]) async throws -> [MeshDepletion] {
        struct Resp: Decodable { let states: [MeshDepletion] }
        var req = URLRequest(url: indexerURL.appendingPathComponent("v1/mesh-states"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["triangle_id_hashes": hashes])
        let (data, response) = try await session.data(for: req)
        try Self.ok(response, data)
        return try JSONDecoder().decode(Resp.self, from: data).states
    }

    private static func ok(_ response: URLResponse, _ data: Data) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
    }
}
