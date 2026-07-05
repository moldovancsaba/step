// Mesh map (M7 #28): iOS embeds the same production MapLibre GL JS globe
// surface as the web app for the canonical Earth + spherical icosahedron view
// (docs/engineering/STEP_mesh_globe_visual_ssot.md). When the web globe URL is
// not configured or WebKit is unavailable, a status strip + placeholder shows
// mesh availability without rendering a map.
//
// Accessibility: state is exposed in text, not colour alone; the view keeps
// default font scaling and does not force motion.
import Foundation
import SwiftUI
import CoreLocation
import StepCore

#if canImport(WebKit) && os(iOS)
import WebKit
#endif

public struct MapView: View {
    let client: MeshCoverClient
    let canonicalGlobeURL: URL?
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

    public init(client: MeshCoverClient, canonicalGlobeURL: URL? = nil) {
        self.client = client
        self.canonicalGlobeURL = canonicalGlobeURL
    }

    private var embedURL: URL? {
        canonicalGlobeURL.flatMap(Self.embedGlobeURL(for:))
    }

    public var body: some View {
        #if canImport(WebKit) && os(iOS)
        if let embedURL {
            CanonicalGlobeMap(url: embedURL)
                .accessibilityLabel("STEP Earth mesh globe")
                .accessibilityHint("Shows the live spherical mesh, lets you rotate and zoom the globe, and keeps only your current triangle selected.")
        } else {
            nativeMapBody
        }
        #else
        nativeMapBody
        #endif
    }

    @ViewBuilder private var nativeMapBody: some View {
        VStack(spacing: 0) {
            statusStrip

            ContentUnavailableView(
                "Mesh map unavailable",
                systemImage: "map",
                description: Text("Map rendering is currently unavailable in this build environment.")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding()
            .background(StepColor.surface)
            .accessibilityLabel("Mesh map unavailable in this build environment")
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
            phase = result.truncated ? .truncated(result.suggestedLevel) : .loaded
        } catch {
            if Task.isCancelled { return }
            phase = .failed("Couldn't load the mesh. Retry.")
        }
    }

    private static func embedGlobeURL(for url: URL) -> URL? {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "surface" }
        queryItems.append(URLQueryItem(name: "surface", value: "ios-map"))
        components.queryItems = queryItems
        return components.url ?? url
    }
}

#if canImport(WebKit) && os(iOS)
private struct CanonicalGlobeMap: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor.clear
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url != url else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
    }
}
#endif

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
