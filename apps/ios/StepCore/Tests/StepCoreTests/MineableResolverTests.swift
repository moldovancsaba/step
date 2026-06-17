import Foundation
import Testing

@testable import StepCore

/// Resolves any (lat,lon,level) to a triangle whose id/hash encode the level, so
/// tests can drive the walk deterministically without a network.
private struct MockResolver: TriangleResolving {
    func resolveTriangle(lat: Double, lon: Double, level: Int) async throws -> TriangleInfo {
        let json = """
        {"triangle_id":"t\(level)","triangle_id_hash":"0x\(level)","level":\(level),
         "vertices":[{"lat":0,"lon":0},{"lat":0,"lon":1},{"lat":1,"lon":0}],
         "centroid":{"lat":0,"lon":0},"area_m2":1.0,"min_side_m":1.0,
         "parent":null,"neighbours":[]}
        """
        return try JSONDecoder().decode(TriangleInfo.self, from: Data(json.utf8))
    }
}

private struct MockState: TriangleStateProviding {
    let states: [String: TriangleState]
    func triangleState(triangleIdHash: String) async throws -> TriangleState {
        states[triangleIdHash] ?? TriangleState(usedSlots: 0, totalSlots: 27, frozen: false)
    }
}

private func resolver(_ states: [String: TriangleState]) -> MineableResolver {
    MineableResolver(resolver: MockResolver(), state: MockState(states: states))
}

@Suite struct MineableResolverTests {
    @Test func virginLocationMinesGenesisLevelOne() async throws {
        let (tri, level) = try await resolver([:]).currentMineable(lat: 47.5, lon: 19.0)
        #expect(level == 1)
        #expect(tri.triangleId == "t1")
    }

    @Test func exhaustedGenesisDescendsToChild() async throws {
        // Level-1 face full (27/27) → mine the level-2 child.
        let states = ["0x1": TriangleState(usedSlots: 27, totalSlots: 27, frozen: false)]
        let (_, level) = try await resolver(states).currentMineable(lat: 47.5, lon: 19.0)
        #expect(level == 2)
    }

    @Test func walksToTerminalLevelThenDeserts() async throws {
        // Levels 1…20 exhausted, 21 still open → mine level 21.
        var states: [String: TriangleState] = [:]
        for l in 1...20 { states["0x\(l)"] = TriangleState(usedSlots: 27, totalSlots: 27, frozen: false) }
        let (_, level) = try await resolver(states).currentMineable(lat: 0, lon: 0)
        #expect(level == 21)

        // Now exhaust 21 too → desert.
        states["0x21"] = TriangleState(usedSlots: 27, totalSlots: 27, frozen: false)
        var desertErr: MineableError?
        do {
            _ = try await resolver(states).currentMineable(lat: 0, lon: 0)
        } catch let e as MineableError {
            desertErr = e
        }
        #expect(desertErr == .desert)
    }

    @Test func frozenTriangleIsRejected() async throws {
        let states = ["0x1": TriangleState(usedSlots: 3, totalSlots: 27, frozen: true)]
        var frozenErr: MineableError?
        do {
            _ = try await resolver(states).currentMineable(lat: 47.5, lon: 19.0)
        } catch let e as MineableError {
            frozenErr = e
        }
        #expect(frozenErr == .frozen(triangleId: "t1"))
    }
}
