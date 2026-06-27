// Oasis/desert map (M7 #28): a MapLibre basemap with validator/indexer mesh overlay.
// Triangles are coloured green→red by mining depletion (~30% opacity), from
// validator cover (#15) + indexer states (#16) via MeshCoverClient.
// Tapping the legend explains the ramp. Truncated viewports prompt "zoom in".
//
// Accessibility: depletion is exposed in text (legend + counts), not colour
// alone; the overlay map keeps default font scaling and does not force motion.
import Foundation
import SwiftUI
import CoreLocation
import StepCore

#if canImport(MapLibre) && os(iOS)
import MapLibre
#endif

public struct MapView: View {
    let client: MeshCoverClient
    @State private var triangles: [MeshOverlayTriangle] = []
    @State private var phase: Phase = .idle
    @State private var displayLevel = 10
    @State private var fetchTask: Task<Void, Never>?
    @State private var lastViewport: MapViewport?

    enum Phase: Equatable { case idle, loading, loaded, truncated(Int), failed(String) }

    private static let defaultViewport = MapViewport(
        minLat: 47.4479,
        minLon: 18.9902,
        maxLat: 47.5479,
        maxLon: 19.0902
    )

    public init(client: MeshCoverClient) { self.client = client }

    public var body: some View {
        VStack(spacing: 0) {
            statusStrip

            #if canImport(MapLibre) && os(iOS)
            MeshMap(triangles: triangles) { viewport in
                lastViewport = viewport
                scheduleFetch(viewport: viewport)
            }
            .overlay(alignment: .bottomLeading) { legend }
            .accessibilityLabel("Map of the live mesh overlay")
            .accessibilityHint("Shows open, filling, and mined-out triangles around your current viewport.")
            #else
            ContentUnavailableView(
                "Mesh map unavailable",
                systemImage: "map",
                description: Text("Map rendering is currently unavailable in this build environment.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
            .background(StepColor.surface)
            .accessibilityLabel("Mesh map unavailable in this build environment")
            #endif
        }
        .task {
            if lastViewport == nil {
                scheduleFetch(viewport: Self.defaultViewport)
            }
        }
    }

    @ViewBuilder private var statusStrip: some View {
        switch phase {
        case .loading:
            HStack { ProgressView(); Text("Loading mesh…") }
                .font(.caption)
                .foregroundStyle(StepColor.textMuted)
                .frame(maxWidth: .infinity)
                .padding(StepSpacing.sm)
                .accessibilityLabel("Loading mesh overlay")
        case .truncated(let suggested):
            Text("Too many triangles at this zoom — zoom in or use level \(suggested).")
                .font(.caption)
                .foregroundStyle(StepColor.warning)
                .frame(maxWidth: .infinity)
                .padding(StepSpacing.sm)
                .accessibilityLabel("Zoomed out too far. Too many triangles at this zoom.")
        case .failed(let msg):
            HStack {
                Text(msg).font(.caption).foregroundStyle(StepColor.danger)
                Button("Retry") {
                    if let viewport = lastViewport {
                        scheduleFetch(viewport: viewport)
                    }
                }
                .font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(StepSpacing.sm)
            .accessibilityLabel("Mesh fetch failed. Retry available.")
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
                Circle().fill(Color.green).frame(width: 10, height: 10)
                Text("open").font(.caption2)
                Circle().fill(StepColor.depletion(0.8)).frame(width: 10, height: 10)
                Text("filling").font(.caption2)
                Circle().fill(StepColor.depletion(1.0)).frame(width: 10, height: 10)
                Text("mined out").font(.caption2)
            }
        }
        .padding(StepSpacing.sm)
        .background(StepColor.surface.opacity(0.9), in: RoundedRectangle(cornerRadius: StepRadius.sm))
        .padding(StepSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Legend. \(counts.oasis) oasis, \(counts.filling) filling, \(counts.desert) desert triangles. Green is open to mine, yellow is filling, red is mined out.")
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
    private func scheduleFetch(viewport: MapViewport) {
        fetchTask?.cancel()
        fetchTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000) // 300ms debounce
            if Task.isCancelled { return }
            await fetch(viewport: viewport)
        }
    }

    private func fetch(viewport: MapViewport) async {
        phase = .loading
        let clamped = viewport.clamped
        do {
            let result = try await client.overlay(
                minLat: clamped.minLat,
                minLon: clamped.minLon,
                maxLat: clamped.maxLat,
                maxLon: clamped.maxLon,
                level: displayLevel
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

private struct MapViewport: Equatable {
    let minLat: Double
    let minLon: Double
    let maxLat: Double
    let maxLon: Double

    var clamped: MapViewport {
        let safeMinLat = max(-89.0, min(minLat, 89.0))
        let safeMaxLat = max(-89.0, min(maxLat, 89.0))
        let safeMinLon = ((minLon + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) - 180
        let safeMaxLon = ((maxLon + 180).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) - 180
        return .init(
            minLat: min(safeMinLat, safeMaxLat),
            minLon: min(safeMinLon, safeMaxLon),
            maxLat: max(safeMinLat, safeMaxLat),
            maxLon: max(safeMinLon, safeMaxLon)
        )
    }
}

#if canImport(MapLibre) && os(iOS)
private struct MeshMap: UIViewRepresentable {
    let triangles: [MeshOverlayTriangle]
    let onViewportChange: (MapViewport) -> Void
    private let mapStyleURL = URL(string: "https://demotiles.maplibre.org/style.json")

    func makeCoordinator() -> Coordinator { Coordinator(onViewportChange: onViewportChange) }

    func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero, styleURL: mapStyleURL)
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        mapView.delegate = context.coordinator
        mapView.logoView.isHidden = true
        mapView.attributionButton.isHidden = true
        mapView.showsUserLocation = false
        mapView.setCenter(
            CLLocationCoordinate2D(latitude: 47.4979, longitude: 19.0402),
            zoomLevel: 11,
            animated: false
        )
        context.coordinator.mapView = mapView
        return mapView
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        context.coordinator.refreshTriangles(on: mapView, triangles: triangles)
        context.coordinator.mapView = mapView
        context.coordinator.captureCurrentViewportIfPossible(on: mapView)
    }

    final class Coordinator: NSObject, MLNMapViewDelegate {
        let onViewportChange: (MapViewport) -> Void
        weak var mapView: MLNMapView?
        private let layerIds = ["step-oasis-fill", "step-oasis-line", "step-filling-fill", "step-filling-line", "step-desert-fill", "step-desert-line"]
        private let sourceIds = ["step-oasis", "step-filling", "step-desert"]

        init(onViewportChange: @escaping (MapViewport) -> Void) {
            self.onViewportChange = onViewportChange
        }

        func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) {
            captureCurrentViewportIfPossible(on: mapView)
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            captureCurrentViewportIfPossible(on: mapView)
        }

        func captureCurrentViewportIfPossible(on mapView: MLNMapView) {
            guard let viewport = self.viewport(from: mapView) else { return }
            onViewportChange(viewport)
        }

        func refreshTriangles(on mapView: MLNMapView, triangles: [MeshOverlayTriangle]) {
            guard let style = mapView.style else { return }
            removeMeshLayers(from: style)
            addTriangles(to: style, triangles: triangles)
        }

        private func removeMeshLayers(from style: MLNStyle) {
            for id in layerIds {
                if let layer = style.layer(withIdentifier: id) {
                    style.removeLayer(layer)
                }
            }
            for id in sourceIds {
                if let source = style.source(withIdentifier: id) {
                    style.removeSource(source)
                }
            }
        }

        private func addTriangles(to style: MLNStyle, triangles: [MeshOverlayTriangle]) {
            addLayer(to: style, triangles: triangles, state: "oasis", color: UIColor.systemGreen, sourceId: "step-oasis", fillLayerId: "step-oasis-fill", lineLayerId: "step-oasis-line")
            addLayer(to: style, triangles: triangles, state: "filling", color: UIColor.systemYellow, sourceId: "step-filling", fillLayerId: "step-filling-fill", lineLayerId: "step-filling-line")
            addLayer(to: style, triangles: triangles, state: "desert", color: UIColor.systemRed, sourceId: "step-desert", fillLayerId: "step-desert-fill", lineLayerId: "step-desert-line")
        }

        private func addLayer(
            to style: MLNStyle,
            triangles: [MeshOverlayTriangle],
            state: String,
            color: UIColor,
            sourceId: String,
            fillLayerId: String,
            lineLayerId: String
        ) {
            let stateTriangles = triangles.filter { $0.stateLabel == state }
            if stateTriangles.isEmpty { return }

            var shapes: [MLNPolygonFeature] = []
            shapes.reserveCapacity(stateTriangles.count)

            for triangle in stateTriangles {
                var points = triangle.triangle.vertices.map {
                    CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
                }
                guard points.count >= 3 else { continue }
                let feature = MLNPolygonFeature(coordinates: &points, count: points.count)
                shapes.append(feature)
            }

            guard !shapes.isEmpty else { return }

            let source = MLNShapeSource(
                identifier: sourceId,
                features: shapes,
                options: nil
            )
            style.addSource(source)

            let fillLayer = MLNFillStyleLayer(identifier: fillLayerId, source: source)
            fillLayer.fillColor = NSExpression(forConstantValue: color)
            fillLayer.fillOpacity = NSExpression(forConstantValue: 0.45)
            style.addLayer(fillLayer)

            let lineLayer = MLNLineStyleLayer(identifier: lineLayerId, source: source)
            lineLayer.lineColor = NSExpression(forConstantValue: StepColor.border.uiColor)
            lineLayer.lineWidth = NSExpression(forConstantValue: 0.75)
            lineLayer.lineOpacity = NSExpression(forConstantValue: 0.85)
            style.addLayer(lineLayer)
        }

        private func viewport(from mapView: MLNMapView) -> MapViewport? {
            let bounds = mapView.visibleCoordinateBounds
            let minLat = bounds.sw.latitude
            let maxLat = bounds.ne.latitude
            let minLon = bounds.sw.longitude
            let maxLon = bounds.ne.longitude
            guard minLat.isFinite && maxLat.isFinite && minLon.isFinite && maxLon.isFinite else { return nil }

            return MapViewport(
                minLat: minLat,
                minLon: minLon,
                maxLat: maxLat,
                maxLon: maxLon
            )
        }
    }
}

private extension Color {
    var uiColor: UIColor { UIColor(self) }
}
#endif
