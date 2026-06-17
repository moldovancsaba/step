// Marketplace tab (M7 #30): browse active triangle-slot-NFT listings + trade
// history (marketplace indexer #10), and list / buy / cancel / gift via on-chain
// TriangleMarketplace (#8). GDS-parity cards/dialogs; every spend or transfer is
// behind an explicit confirmation that shows the price. Testnet only — Trinity
// has no monetary value. Fully accessible (VoiceOver, Dynamic Type, 44pt, non-
// colour status, confirmation focus).
import SwiftUI
import os
import StepCore

private let marketLog = Logger(subsystem: "app.step.miner", category: "market")

struct MarketplaceView: View {
    @ObservedObject var model: AppModel
    @State private var showMineOnly = false
    @State private var pending: PendingAction?
    @State private var listSheet = false

    /// A confirmed-before-send action.
    struct PendingAction: Identifiable {
        let id = UUID()
        let title: String
        let message: String
        let confirmLabel: String
        let run: (MarketplaceWriter) async throws -> String
    }

    var body: some View {
        List {
            if !model.canTrade {
                Section {
                    Label("Testnet marketplace — trading turns on once contracts are deployed on this network. You can still browse.",
                          systemImage: "info.circle")
                        .font(.footnote).foregroundStyle(StepColor.textMuted)
                }
            }
            if let status = model.marketStatus {
                Section { Text(status).font(.footnote).foregroundStyle(StepColor.textMuted)
                    .accessibilityLabel("Marketplace status. \(status)") }
            }
            Section {
                Toggle("My listings only", isOn: $showMineOnly)
                    .accessibilityHint("Filter to listings you created")
            }
            listingsSection
        }
        .refreshable { await model.loadListings() }
        .task { await model.loadListings() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { listSheet = true } label: { Label("List a triangle", systemImage: "plus") }
                    .disabled(!model.canTrade)
                    .accessibilityHint("Create a new listing")
            }
        }
        .sheet(isPresented: $listSheet) { ListTriangleSheet(model: model) }
        .confirmationDialog(pending?.title ?? "", isPresented: confirmBinding, presenting: pending) { action in
            Button(action.confirmLabel, role: action.confirmLabel == "Cancel listing" ? .destructive : nil) {
                let run = action.run
                Task { await model.runMarketAction(run) }
            }
            Button("Back", role: .cancel) {}
        } message: { action in Text(action.message) }
    }

    private var confirmBinding: Binding<Bool> {
        Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })
    }

    @ViewBuilder private var listingsSection: some View {
        switch model.listings {
        case .idle, .loading:
            Section { HStack { ProgressView(); Text("Loading listings…") }
                .accessibilityLabel("Loading listings") }
        case .empty:
            Section { ContentUnavailableView("No active listings", systemImage: "bag",
                description: Text("When miners list triangles for Trinity, they show up here.")) }
        case .failed(let message):
            Section {
                VStack(alignment: .leading, spacing: StepSpacing.sm) {
                    Text(message).foregroundStyle(StepColor.danger)
                    Button("Retry") { Task { await model.loadListings() } }
                }
            }
        case .loaded(let all):
            let mine = model.walletAddress?.lowercased()
            let shown = showMineOnly ? all.filter { $0.seller.lowercased() == mine } : all
            if shown.isEmpty {
                Section { Text("You have no active listings.").foregroundStyle(StepColor.textMuted) }
            } else {
                Section("Active listings") {
                    ForEach(shown) { listing in
                        ListingRow(listing: listing, isMine: listing.seller.lowercased() == mine,
                                   canTrade: model.canTrade, onAction: prepare)
                    }
                }
            }
        }
    }

    /// Build the confirmation for a chosen action.
    private func prepare(_ kind: ListingRow.ActionKind, _ listing: Listing) {
        marketLog.info("market action prepare \(kind.rawValue, privacy: .public) token=\(listing.tokenId, privacy: .public)")
        switch kind {
        case .buy:
            pending = PendingAction(
                title: "Buy triangle #\(listing.tokenId)",
                message: "Pay \(listing.priceTrinity) Trinity (testnet, no real value). You'll approve Trinity if needed, then the purchase is sent.",
                confirmLabel: "Buy for \(listing.priceTrinity) Trinity"
            ) { try await $0.buy(tokenId: listing.tokenId, priceTrinity: listing.priceTrinity) }
        case .cancel:
            pending = PendingAction(
                title: "Cancel listing #\(listing.tokenId)",
                message: "Remove this listing. Your triangle stays in your wallet.",
                confirmLabel: "Cancel listing"
            ) { try await $0.cancel(tokenId: listing.tokenId) }
        }
    }
}

private struct ListingRow: View {
    enum ActionKind: String { case buy, cancel }
    let listing: Listing
    let isMine: Bool
    let canTrade: Bool
    let onAction: (ActionKind, Listing) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: StepSpacing.xs) {
            HStack {
                Text("Triangle #\(listing.tokenId)").font(.headline)
                Spacer()
                Text("\(listing.priceTrinity) Trinity").font(.subheadline.weight(.semibold))
            }
            Text("Seller \(short(listing.seller))\(isMine ? " · you" : "")")
                .font(.caption).foregroundStyle(StepColor.textMuted)
            if canTrade {
                HStack {
                    if isMine {
                        Button("Cancel", role: .destructive) { onAction(.cancel, listing) }
                            .frame(minHeight: 44)
                    } else {
                        Button("Buy") { onAction(.buy, listing) }
                            .buttonStyle(.borderedProminent).frame(minHeight: 44)
                    }
                }
            }
        }
        .padding(.vertical, StepSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Triangle \(listing.tokenId), \(listing.priceTrinity) Trinity, seller \(short(listing.seller))\(isMine ? ", your listing" : "")")
    }

    private func short(_ a: String) -> String { a.count > 12 ? "\(a.prefix(6))…\(a.suffix(4))" : a }
}

/// Sheet to list one of the miner's triangles for a Trinity price, or gift it.
private struct ListTriangleSheet: View {
    @ObservedObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var tokenId = ""
    @State private var price = ""
    @State private var giftTo = ""
    @State private var mode: Mode = .list
    enum Mode: String, CaseIterable { case list = "List for sale"; case gift = "Gift" }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Action", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }.pickerStyle(.segmented)

                Section("Triangle") {
                    TextField("Token id (e.g. 7)", text: $tokenId)
                        .stepNumberPad()
                        .accessibilityLabel("Token id")
                }
                switch mode {
                case .list:
                    Section("Price") {
                        TextField("Trinity (whole number ≥ 1)", text: $price)
                            .stepNumberPad()
                            .accessibilityLabel("Price in Trinity")
                        Text("Trinity is a testnet token with no monetary value.")
                            .font(.caption).foregroundStyle(StepColor.textMuted)
                    }
                case .gift:
                    Section("Recipient") {
                        TextField("0x wallet address", text: $giftTo)
                            .autocorrectionDisabled().stepNoAutocap()
                            .accessibilityLabel("Recipient wallet address")
                    }
                }
                Section {
                    Button(mode == .list ? "List triangle" : "Gift triangle") { submit() }
                        .disabled(!isValid)
                        .frame(maxWidth: .infinity).frame(minHeight: 44)
                }
            }
            .navigationTitle("List a triangle")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private var isValid: Bool {
        guard !tokenId.isEmpty else { return false }
        switch mode {
        case .list: return (Int(price) ?? 0) >= 1
        case .gift: return giftTo.hasPrefix("0x") && giftTo.count == 42
        }
    }

    private func submit() {
        let token = tokenId, p = price, to = giftTo, m = mode
        dismiss()
        Task {
            await model.runMarketAction { writer in
                switch m {
                case .list: return try await writer.list(tokenId: token, priceTrinity: p)
                case .gift: return try await writer.gift(tokenId: token, to: to)
                }
            }
        }
    }
}

// Cross-platform shims: number-pad keyboard and no-autocapitalisation are
// iOS-only modifiers; on macOS (CI builds StepCore there) they are no-ops.
private extension View {
    @ViewBuilder func stepNumberPad() -> some View {
        #if os(iOS)
        self.keyboardType(.numberPad)
        #else
        self
        #endif
    }

    @ViewBuilder func stepNoAutocap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }
}
