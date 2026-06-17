import Foundation
import Testing

@testable import StepCore

@Suite struct MeshCoverClientTests {
    @Test func decodesCoverResult() throws {
        let json = """
        {"triangles":[
          {"triangle_id":"1.2.3","triangle_id_hash":"0xaa",
           "vertices":[{"lat":47.5,"lon":19.0},{"lat":47.6,"lon":19.1},{"lat":47.4,"lon":19.2}]}
        ],"truncated":false,"suggested_level":10}
        """
        let r = try JSONDecoder().decode(CoverResult.self, from: Data(json.utf8))
        #expect(r.triangles.count == 1)
        #expect(r.triangles[0].triangleId == "1.2.3")
        #expect(r.triangles[0].vertices.count == 3)
        #expect(!r.truncated)
    }

    @Test func decodesTruncatedCover() throws {
        let json = #"{"triangles":[],"truncated":true,"suggested_level":7}"#
        let r = try JSONDecoder().decode(CoverResult.self, from: Data(json.utf8))
        #expect(r.truncated)
        #expect(r.suggestedLevel == 7)
    }

    @Test func decodesDepletionState() throws {
        let json = """
        {"triangle_id_hash":"0xaa","used_slots":14,"total_slots":27,
         "depletion":0.5185,"state":"filling","frozen":false}
        """
        let d = try JSONDecoder().decode(MeshDepletion.self, from: Data(json.utf8))
        #expect(d.usedSlots == 14)
        #expect(d.state == "filling")
        #expect(!d.frozen)
    }

    @Test func overlayTriangleDefaultsToOasisWhenNoState() {
        let tri = CoverTriangle(triangleId: "1", triangleIdHash: "0xaa", vertices: [])
        let o = MeshOverlayTriangle(triangle: tri, depletion: nil)
        #expect(o.depletionRatio == 0)
        #expect(o.stateLabel == "oasis")
    }
}
