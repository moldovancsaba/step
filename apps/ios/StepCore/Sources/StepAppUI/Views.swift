// Miner app screens (SYS §16.2, DEV §6.3 flows). SwiftUI, cross-platform so
// CI compiles them via `swift build`; the iOS app target embeds them
// unchanged. The triangle is rendered natively from canonical vertices —
// the full MapLibre basemap integration is the documented next step
// (apps/ios/README).
import SwiftUI
import StepCore

/// The app shell (M7 #25): GDS-themed, tab-based chrome (Mine · Map · Wallet ·
/// Marketplace) with a persistent testnet banner and an account/sign-out slot.
/// Gates on a wallet today; the login wall (#27) drives this via SessionContext.
public struct RootView: View {
    @ObservedObject var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            if model.walletAddress != nil {
                if let mode = model.launcherMode {
                    switch mode {
                    case .miner:
                        shell
                    case .mobileTrustCenter:
                        NavigationStack {
                            MobileTrustCenterView(model: model)
                                .stepChrome("Mobile Trust Center", model: model)
                        }
                    }
                } else {
                    LauncherView(model: model)
                }
            } else if model.hasAccount {
                LoginWall(model: model)   // #27: account/login gate
            } else {
                OnboardingView(model: model)  // device-local-key onboarding
            }
        }
        .background(StepColor.background.ignoresSafeArea())
    }

    private var shell: some View {
        TabView {
            NavigationStack { MineView(model: model).stepChrome("Mine", model: model) }
                .tabItem { Label("Mine", systemImage: "triangle.fill") }
            NavigationStack { MapTabView(model: model).stepChrome("Map", model: model) }
                .tabItem { Label("Map", systemImage: "map.fill") }
            NavigationStack { WalletTabView(model: model).stepChrome("Wallet", model: model) }
                .tabItem { Label("Wallet", systemImage: "wallet.pass.fill") }
            NavigationStack { MarketTabView(model: model).stepChrome("Marketplace", model: model) }
                .tabItem { Label("Market", systemImage: "bag.fill") }
        }
        .tint(StepColor.primary)
    }
}

/// Persistent testnet notice (GDS banner parity). Trinity has no monetary value.
struct TestnetBanner: View {
    var body: some View {
        Text("Testnet pilot — Trinity has no monetary value")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(StepColor.onPrimary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, StepSpacing.xs)
            .background(StepColor.warning)
            .accessibilityLabel("Testnet pilot. Trinity has no monetary value.")
    }
}

/// Shared chrome: navigation title, testnet banner, and an account/sign-out slot.
private struct StepChrome: ViewModifier {
    let title: String
    @ObservedObject var model: AppModel

    func body(content: Content) -> some View {
        content
            .navigationTitle(title)
            .safeAreaInset(edge: .top, spacing: 0) { TestnetBanner() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        if let addr = model.walletAddress {
                            Text(addr).font(.system(.caption2, design: .monospaced))
                        }
                        Button("Launcher") { model.returnToLauncher() }
                        Button("Sign out", role: .destructive) { model.signOut() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                            .accessibilityLabel("Account")
                    }
                }
            }
    }
}

extension View {
    func stepChrome(_ title: String, model: AppModel) -> some View {
        modifier(StepChrome(title: title, model: model))
    }
}

/// Choosable launcher: users can either mine/explore or run this device as a
/// Mobile Trust Center while it is awake and the app remains running.
struct LauncherView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StepSpacing.lg) {
                Text("STEP").font(.largeTitle.bold()).foregroundStyle(StepColor.text)
                Text("Choose how this device helps the network")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(StepColor.text)
                Text("You can switch modes any time from the account menu.")
                    .font(.callout)
                    .foregroundStyle(StepColor.textMuted)

                LauncherCard(
                    title: "Mine & explore",
                    icon: "triangle.fill",
                    description: "Visit triangles, create signed proof-of-location claims, manage your wallet, and trade triangle slots.",
                    footnote: "Rewards come from mining actual locations."
                ) {
                    model.chooseLauncherMode(.miner)
                }

                LauncherCard(
                    title: "Mobile Trust Center",
                    icon: "ipad.and.iphone",
                    description: "Keep this iPhone or iPad awake to act as an attested mobile trust device. It can later contribute signed votes and earn trust-center rewards without visiting new locations.",
                    footnote: "Requires the app to stay open, network connected, powered, and enrolled by protocol policy."
                ) {
                    model.startMobileTrustCenter()
                }
            }
            .padding(StepSpacing.lg)
        }
        .background(StepColor.background.ignoresSafeArea())
    }
}

struct LauncherCard: View {
    let title: String
    let icon: String
    let description: String
    let footnote: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: StepSpacing.sm) {
                HStack(spacing: StepSpacing.sm) {
                    Image(systemName: icon)
                        .font(.title2)
                        .foregroundStyle(StepColor.primary)
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(StepColor.text)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(StepColor.textMuted)
                }
                Text(description)
                    .font(.callout)
                    .foregroundStyle(StepColor.text)
                    .multilineTextAlignment(.leading)
                Text(footnote)
                    .font(.caption)
                    .foregroundStyle(StepColor.textMuted)
                    .multilineTextAlignment(.leading)
            }
            .padding(StepSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(StepColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: StepRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: StepRadius.lg, style: .continuous)
                    .stroke(StepColor.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(title + ". " + description + ". " + footnote))
    }
}

/// Foreground Mobile Trust Center screen. This mode does not claim background
/// daemon guarantees; it is explicit about the device obligations.
struct MobileTrustCenterView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: StepSpacing.sm) {
                    Label(
                        model.mobileTrustCenterActive ? "Mobile Trust Center is active" : "Mobile Trust Center is paused",
                        systemImage: model.mobileTrustCenterActive ? "checkmark.seal.fill" : "pause.circle"
                    )
                    .font(.headline)
                    .foregroundStyle(model.mobileTrustCenterActive ? StepColor.success : StepColor.textMuted)
                    Text("Keep this device unlocked, powered, connected, and on this screen to contribute as a mobile trust device.")
                        .font(.callout)
                        .foregroundStyle(StepColor.textMuted)
                }
                .accessibilityElement(children: .combine)
            }

            Section("This device can contribute") {
                TrustCapabilityRow(icon: "key.fill", title: "Wallet identity", detail: "Signs as your self-custody STEP address.")
                TrustCapabilityRow(icon: "checkmark.shield.fill", title: "Device attestation", detail: "Uses App Attest on real hardware when available.")
                TrustCapabilityRow(icon: "signature", title: "Future vote signing", detail: "Prepared for protocol-enrolled mobile trust votes and rewards.")
                TrustCapabilityRow(icon: "network", title: "P2P support", detail: "Acts as a mobile participant while the app is running.")
            }

            Section("Reward model") {
                Text("Mobile Trust Center rewards are separate from location mining. They can later reward uptime, valid participation, and attested device contribution without requiring the owner to visit new triangles.")
                    .font(.callout)
                    .foregroundStyle(StepColor.text)
                Text("No production reward is promised until the protocol parameter and enrollment policy are activated.")
                    .font(.caption)
                    .foregroundStyle(StepColor.textMuted)
            }

            Section {
                if model.mobileTrustCenterActive {
                    Button("Pause Mobile Trust Center", role: .destructive) {
                        model.stopMobileTrustCenter()
                    }
                } else {
                    Button("Start Mobile Trust Center") {
                        model.startMobileTrustCenter()
                    }
                }
                Button("Return to launcher") {
                    model.returnToLauncher()
                }
            }
        }
    }
}

struct TrustCapabilityRow: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: StepSpacing.sm) {
            Image(systemName: icon)
                .foregroundStyle(StepColor.primary)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.semibold))
                Text(detail).font(.caption).foregroundStyle(StepColor.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Map tab — oasis/desert MapKit overlay (#28) when a cover client is wired,
/// else a short explainer.
struct MapTabView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        if let cover = model.cover {
            MapView(client: cover)
        } else {
            ContentUnavailableView(
                "Oasis / desert map",
                systemImage: "map",
                description: Text("Configure a mesh + indexer endpoint to see the depletion overlay.")
            )
        }
    }
}

/// Marketplace tab — placeholder until the marketplace UI (#30) lands.
struct MarketTabView: View {
    @ObservedObject var model: AppModel
    var body: some View { MarketplaceView(model: model) }
}

/// Wallet tab: address + owned slot NFTs (#29) with provenance, plus links to
/// claim history and privacy settings (folded in so the shell stays at 4 tabs).
struct WalletTabView: View {
    @ObservedObject var model: AppModel
    var body: some View {
        List {
            Section { WalletView(model: model) }
            Section("Your triangles") {
                switch model.ownedNfts {
                case .idle, .loading:
                    HStack { ProgressView(); Text("Loading your triangles…") }
                        .foregroundStyle(StepColor.textMuted)
                        .accessibilityLabel("Loading your triangles")
                case .empty:
                    Text("No triangles yet — mine one to earn its slot NFT.")
                        .font(.callout).foregroundStyle(StepColor.textMuted)
                case .failed(let message):
                    VStack(alignment: .leading, spacing: StepSpacing.sm) {
                        Text(message).font(.callout).foregroundStyle(StepColor.danger)
                        Button("Try again") { Task { await model.loadOwnedNfts() } }
                    }
                case .loaded(let tokens):
                    ForEach(tokens) { NftRow(token: $0) }
                }
            }
            KeyManagementSection(model: model)
            Section {
                NavigationLink { HistoryView(model: model).navigationTitle("Claims") } label: {
                    Label("Claim history", systemImage: "clock")
                }
                NavigationLink { SettingsView(model: model).navigationTitle("Privacy") } label: {
                    Label("Privacy & data rights", systemImage: "hand.raised")
                }
            }
        }
        .task { await model.loadOwnedNfts() }
        .refreshable { await model.loadOwnedNfts() }
    }
}

/// One owned slot NFT with provenance; landlord conveyed in text + badge (never
/// colour alone) for accessibility.
struct NftRow: View {
    let token: NftToken
    var body: some View {
        VStack(alignment: .leading, spacing: StepSpacing.xs) {
            HStack {
                Text(token.triangleIdHash.prefix(14) + "…")
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(StepColor.text)
                Spacer()
                if token.isLandlord {
                    Text("Landlord")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, StepSpacing.sm).padding(.vertical, 2)
                        .background(StepColor.primary.opacity(0.15))
                        .foregroundStyle(StepColor.primary)
                        .clipShape(Capsule())
                }
            }
            Text("Level \(token.level) · slot \(token.slot) · miner #\(token.miningOrder)")
                .font(.caption).foregroundStyle(StepColor.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Triangle \(token.triangleIdHash.prefix(10)), level \(token.level), slot \(token.slot)"
                + (token.isLandlord ? ", landlord" : "")
        )
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
    /// Per-attempt session nonce for optional anchor capture (#32). Production
    /// binds the anchor proof to the claim nonce; this is the pre-claim seam.
    @State private var anchorNonce = UUID().uuidString

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

            if let address = model.walletAddress {
                AnchorCaptureView(minerAddress: address, nonce: anchorNonce) { proof in
                    model.capturedAnchor = proof
                }
            }

            Button {
                Task { await model.mine(at: sample) }
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
