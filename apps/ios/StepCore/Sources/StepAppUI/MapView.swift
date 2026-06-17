// Oasis/desert map (M7 #28): a MapKit map overlaying the viewport's mesh
// triangles coloured green→red by mining depletion (~30% opacity), from the
// validator cover (#15) + indexer states (#16) via MeshCoverClient. Tapping the
// legend explains the ramp. Truncated viewports prompt "zoom in".
//
// Accessibility: depletion is exposed in text (legend + counts), not colour
// alone; Reduce Motion respected (no animated camera); Dynamic Type throughout.
import SwiftUI
import MapKit
import StepCore

public struct MapView: View {
    let client: MeshCoverClient
    @State private var camera: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 47.4979, longitude: 19.0402),
            span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.1)
        )
    )
    @State private var triangles: [MeshOverlayTriangle] = []
    @State private var phase: Phase = .idle
    @State private var displayLevel = 10
    @State private var fetchTask: Task<Void, Never>?

    enum Phase: Equatable { case idle, loading, loaded, truncated(Int), failed(String) }

    public init(client: MeshCoverClient) { self.client = client }

    public var body: some View {
        VStack(spacing: 0) {
            statusStrip
            Map(position: $camera) {
                ForEach(triangles) { t in
                    MapPolygon(coordinates: t.triangle.vertices.map {
                        CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
                    })
                    .foregroundStyle(StepColor.depletion(t.depletionRatio))
                    .stroke(StepColor.border, lineWidth: 0.5)
                }
            }
            .onMapCameraChange(frequency: .onEnd) { ctx in scheduleFetch(region: ctx.region) }
            .overlay(alignment: .bottomLeading) { legend }
        }
        .task { scheduleFetch(region: currentRegion) }
    }

    private var currentRegion: MKCoordinateRegion {
        camera.region ?? MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 47.4979, longitude: 19.0402),
            span: MKCoordinateSpan(latitudeDelta: 0.1, longitudeDelta: 0.1)
        )
    }

    @ViewBuilder private var statusStrip: some View {
        switch phase {
        case .loading:
            HStack { ProgressView(); Text("Loading mesh…") }
                .font(.caption).foregroundStyle(StepColor.textMuted)
                .frame(maxWidth: .infinity).padding(StepSpacing.sm)
                .accessibilityLabel("Loading mesh overlay")
        case .truncated(let suggested):
            Text("Too many triangles at this zoom — zoom in or use level \(suggested).")
                .font(.caption).foregroundStyle(StepColor.warning)
                .frame(maxWidth: .infinity).padding(StepSpacing.sm)
        case .failed(let msg):
            HStack {
                Text(msg).font(.caption).foregroundStyle(StepColor.danger)
                Button("Retry") { scheduleFetch(region: currentRegion) }.font(.caption)
            }
            .frame(maxWidth: .infinity).padding(StepSpacing.sm)
        case .idle, .loaded:
            EmptyView()
        }
    }

    private var legend: some View {
        let counts = counts(triangles)
        return VStack(alignment: .leading, spacing: 2) {
            Text("Oasis \(counts.oasis) · Filling \(counts.filling) · Desert \(counts.desert)")
                .font(.caption2.weight(.medium))
            HStack(spacing: StepSpacing.xs) {
                Circle().fill(StepColor.oasis).frame(width: 10, height: 10)
                Text("open").font(.caption2)
                Circle().fill(StepColor.desert).frame(width: 10, height: 10)
                Text("mined out").font(.caption2)
            }
        }
        .padding(StepSpacing.sm)
        .background(StepColor.surface.opacity(0.9), in: RoundedRectangle(cornerRadius: StepRadius.sm))
        .padding(StepSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Legend. \(counts.oasis) oasis, \(counts.filling) filling, \(counts.desert) desert triangles. Green is open to mine, red is mined out.")
    }

    private func counts(_ ts: [MeshOverlayTriangle]) -> (oasis: Int, filling: Int, desert: Int) {
        ts.reduce(into: (0, 0, 0)) { acc, t in
            switch t.stateLabel {
            case "desert": acc.2 += 1
            case "filling": acc.1 += 1
            default: acc.0 += 1
            }
        }
    }

    /// Debounce + coalesce: cancel any in-flight fetch and start a fresh one.
    private func scheduleFetch(region: MKCoordinateRegion) {
        fetchTask?.cancel()
        fetchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000) // 300ms debounce
            if Task.isCancelled { return }
            await fetch(region: region)
        }
    }

    private func fetch(region: MKCoordinateRegion) async {
        phase = .loading
        let minLat = region.center.latitude - region.span.latitudeDelta / 2
        let maxLat = region.center.latitude + region.span.latitudeDelta / 2
        let minLon = region.center.longitude - region.span.longitudeDelta / 2
        let maxLon = region.center.longitude + region.span.longitudeDelta / 2
        do {
            let result = try await client.overlay(
                minLat: minLat, minLon: minLon, maxLat: maxLat, maxLon: maxLon, level: displayLevel
            )
            if Task.isCancelled { return }
            if result.truncated {
                triangles = []
                phase = .truncated(result.suggestedLevel)
            } else {
                triangles = result.triangles
                phase = .loaded
            }
        } catch {
            if Task.isCancelled { return }
            phase = .failed("Couldn't load the mesh. Retry.")
        }
    }
}
