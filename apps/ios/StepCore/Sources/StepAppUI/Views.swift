// Miner app screens (SYS §16.2, DEV §6.3 flows). SwiftUI, cross-platform so
// CI compiles them via `swift build`; the iOS app target embeds them
// unchanged. The triangle is rendered natively from canonical vertices —
// the full MapLibre basemap integration is the documented next step
// (apps/ios/README).
import SwiftUI
import StepCore

public struct RootView: View {
    @ObservedObject var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        if model.walletAddress == nil {
            OnboardingView(model: model)
        } else {
            TabView {
                MineView(model: model)
                    .tabItem { Label("Mine", systemImage: "triangle") }
                HistoryView(model: model)
                    .tabItem { Label("Claims", systemImage: "clock") }
                WalletView(model: model)
                    .tabItem { Label("Wallet", systemImage: "key") }
                SettingsView(model: model)
                    .tabItem { Label("Privacy", systemImage: "hand.raised") }
            }
        }
    }
}

// Flow A: first launch (DEV §6.3) — explain location use, then wallet.
struct OnboardingView: View {
    @ObservedObject var model: AppModel
    @State private var importKey = ""
    @State private var showImport = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("STEP").font(.largeTitle.bold())
            Text(
                """
                Mine Trinity by proving you are physically present inside a \
                spherical triangle. STEP uses your location ONLY to build a \
                proof-of-presence when you tap Mine — never for tracking. Raw \
                coordinates are encrypted off-chain; only proof hashes are public.
                """
            )
            .font(.callout)
            Text("This is a testnet pilot. Trinity has no monetary value.")
                .font(.footnote)
                .foregroundStyle(.orange)
            Spacer()
            Button("Create wallet") { model.createWallet() }
                .buttonStyle(.borderedProminent)
            Button("Import existing key") { showImport = true }
                .buttonStyle(.bordered)
            if showImport {
                TextField("0x… 32-byte private key hex", text: $importKey)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.footnote, design: .monospaced))
                Button("Import") { model.importWallet(privateKeyHex: importKey) }
            }
        }
        .padding()
    }
}

// Flow B: mine the current triangle.
public struct MineView: View {
    @ObservedObject var model: AppModel
    @State private var manualLat = "47.4979"
    @State private var manualLon = "19.0402"

    public init(model: AppModel) {
        self.model = model
    }

    var sample: LocationSample {
        LocationSample(
            latitude: Double(manualLat) ?? 0,
            longitude: Double(manualLon) ?? 0,
            horizontalAccuracyM: 5.0
        )
    }

    public var body: some View {
        VStack(spacing: 16) {
            if let triangle = model.currentTriangle {
                TriangleShapeView(triangle: triangle)
                    .frame(height: 220)
                VStack(spacing: 4) {
                    Text(triangle.triangleId)
                        .font(.system(.footnote, design: .monospaced))
                    Text("level \(triangle.level) · ~\(String(format: "%.1f", triangle.minSideM)) m sides")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                ContentUnavailableView(
                    "No triangle yet",
                    systemImage: "triangle",
                    description: Text("Update your location to resolve your current MESH triangle.")
                )
            }

            // Alpha dev controls: manual coordinates drive the simulator flow;
            // the device build feeds LocationService output here instead.
            HStack {
                TextField("lat", text: $manualLat).textFieldStyle(.roundedBorder)
                TextField("lon", text: $manualLon).textFieldStyle(.roundedBorder)
                Button("Locate") {
                    Task { await model.updateLocation(sample) }
                }
                .buttonStyle(.bordered)
            }
            .font(.system(.footnote, design: .monospaced))

            Button {
                Task { await model.mine(at: sample, attestation: .devUnattested) }
            } label: {
                Text("Mine triangle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.currentTriangle == nil)

            StatusBadge(status: model.status)
            Spacer()
        }
        .padding()
    }
}

/// Native rendering of the canonical spherical triangle (vertices from the
/// mesh API) with an equirectangular local projection — exact at street scale.
struct TriangleShapeView: View {
    let triangle: TriangleInfo

    var body: some View {
        GeometryReader { geo in
            let points = projected(into: geo.size)
            ZStack {
                Path { path in
                    guard let first = points.first else { return }
                    path.move(to: first)
                    for point in points.dropFirst() { path.addLine(to: point) }
                    path.closeSubpath()
                }
                .fill(Color.green.opacity(0.25))
                Path { path in
                    guard let first = points.first else { return }
                    path.move(to: first)
                    for point in points.dropFirst() { path.addLine(to: point) }
                    path.closeSubpath()
                }
                .stroke(Color.green, lineWidth: 2)
                Circle()
                    .fill(Color.blue)
                    .frame(width: 10, height: 10)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
            }
        }
    }

    func projected(into size: CGSize) -> [CGPoint] {
        let lats = triangle.vertices.map(\.lat)
        let lons = triangle.vertices.map(\.lon)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLon = lons.min(), let maxLon = lons.max(),
              maxLat > minLat, maxLon > minLon
        else { return [] }
        let pad = 0.15
        return triangle.vertices.map { vertex in
            let nx = (vertex.lon - minLon) / (maxLon - minLon)
            let ny = 1 - (vertex.lat - minLat) / (maxLat - minLat)
            return CGPoint(
                x: (pad + nx * (1 - 2 * pad)) * size.width,
                y: (pad + ny * (1 - 2 * pad)) * size.height
            )
        }
    }
}

struct StatusBadge: View {
    let status: ClaimUIStatus

    var body: some View {
        switch status {
        case .idle:
            EmptyView()
        case .locating, .resolvingTriangle:
            Label("Resolving triangle…", systemImage: "location")
        case .readyToMine:
            Label("Ready to mine", systemImage: "checkmark.circle")
                .foregroundStyle(.green)
        case .submitting:
            Label("Signing & submitting…", systemImage: "paperplane")
        case .validating:
            Label("Validators checking proof…", systemImage: "person.3")
        case .finalised(let tx):
            VStack {
                Label("Trinity mined!", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(.green)
                if let tx { Text(tx).font(.system(.caption2, design: .monospaced)) }
            }
        case .rejected(let reasons):
            VStack(alignment: .leading) {
                Label("Claim rejected", systemImage: "xmark.octagon")
                    .foregroundStyle(.red)
                ForEach(reasons, id: \.self) { Text($0).font(.caption2) }
            }
        case .error(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .foregroundStyle(.orange)
                .font(.caption)
        }
    }
}

struct HistoryView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        List(model.claimHistory, id: \.claimHash) { record in
            VStack(alignment: .leading, spacing: 2) {
                Text(record.claimHash)
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(1)
                HStack {
                    Text(record.status)
                        .font(.caption.bold())
                        .foregroundStyle(record.status == "finalised" ? .green : .secondary)
                    if !record.rejectReasons.isEmpty {
                        Text(record.rejectReasons.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .overlay {
            if model.claimHistory.isEmpty {
                ContentUnavailableView("No claims yet", systemImage: "clock")
            }
        }
    }
}

struct WalletView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "key.horizontal")
                .font(.largeTitle)
            Text(model.walletAddress ?? "—")
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
            Text(
                """
                Self-custodial: the key lives only in this device's Keychain. \
                Balance and finalised claims are public chain state — see the \
                explorer for this address.
                """
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            Spacer()
        }
        .padding()
    }
}

struct SettingsView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Form {
            Section("Public profile") {
                Picker("Visibility", selection: $model.privacyMode) {
                    ForEach(AppModel.PrivacyMode.allCases, id: \.self) {
                        Text($0.rawValue)
                    }
                }
                Text(
                    """
                    Default is Private: the public explorer never links your \
                    activity to an identity. Raw GPS never leaves the proof \
                    path and is never published (PRV-001).
                    """
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Section("Data rights") {
                Text("Export claims and wallet activity, or request off-chain evidence deletion, from the pilot support contact. On-chain hashes are permanent — shown before your first claim.")
                    .font(.caption)
            }
        }
    }
}
