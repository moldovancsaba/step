// Current-mineable-triangle resolution for the v2 mining model
// (docs/geography/STEP_mesh_id_v2.md). Mining starts at genesis level 1 and a
// triangle breaks into 4 children once its 27 slots are exhausted; a triangle at
// level N>1 is mineable only after its parent is exhausted. So the triangle to
// mine at a location is the FINEST un-exhausted triangle covering that point —
// found by walking level 1 → 21 and taking the first that still has free slots.
// This mirrors the web app's resolveMineableTriangle. Level 21 is terminal: a
// fully-mined level-21 triangle is a permanent desert.
//
// Transport-agnostic (protocols below) so it is unit-testable without a network.
import Foundation

/// Mining state of one triangle (from the indexer projection).
public struct TriangleState: Sendable, Equatable {
    public let usedSlots: Int
    public let totalSlots: Int
    public let frozen: Bool

    public init(usedSlots: Int, totalSlots: Int, frozen: Bool) {
        self.usedSlots = usedSlots
        self.totalSlots = totalSlots
        self.frozen = frozen
    }

    /// True once every slot is mined — the triangle has broken down (or, at
    /// level 21, become a permanent desert).
    public var isExhausted: Bool { usedSlots >= totalSlots }
}

/// Resolves a coordinate to its triangle at a given mesh level (the gateway /
/// validator mesh API).
public protocol TriangleResolving: Sendable {
    func resolveTriangle(lat: Double, lon: Double, level: Int) async throws -> TriangleInfo
}

/// Looks up the current mining state of a triangle by its id hash (the indexer).
public protocol TriangleStateProviding: Sendable {
    func triangleState(triangleIdHash: String) async throws -> TriangleState
}

public enum MineableError: Error, Equatable, Sendable {
    /// Every level 1…21 covering this point is exhausted — a desert. Only a
    /// merchant re-seed reopens activity here.
    case desert
    /// The current mineable triangle is frozen by safety policy.
    case frozen(triangleId: String)
}

public struct MineableResolver: Sendable {
    /// Terminal mesh level (Mesh ID v2). No level 22.
    public static let maxLevel = 21

    private let resolver: TriangleResolving
    private let state: TriangleStateProviding

    public init(resolver: TriangleResolving, state: TriangleStateProviding) {
        self.resolver = resolver
        self.state = state
    }

    /// The triangle a miner should mine at `(lat, lon)` right now: the finest
    /// un-exhausted triangle covering the point. Throws `.desert` if exhausted
    /// to level 21, or `.frozen` if the current triangle is safety-frozen.
    public func currentMineable(
        lat: Double,
        lon: Double
    ) async throws -> (triangle: TriangleInfo, level: Int) {
        var level = 1
        while level <= Self.maxLevel {
            let triangle = try await resolver.resolveTriangle(lat: lat, lon: lon, level: level)
            let st = try await state.triangleState(triangleIdHash: triangle.triangleIdHash)
            if st.frozen {
                throw MineableError.frozen(triangleId: triangle.triangleId)
            }
            if !st.isExhausted {
                return (triangle, level)
            }
            // Exhausted → it has broken down; descend to the child covering the
            // point at the next finer level.
            level += 1
        }
        throw MineableError.desert
    }
}
