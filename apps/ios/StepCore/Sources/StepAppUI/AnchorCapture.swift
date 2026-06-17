// Trusted-anchor capture UI + transport readers (M7 #32). Optional step in the
// mine flow: read a registered anchor (BLE beacon / NFC tag / rotating QR),
// obtain its signature over the (miner, nonceHash, anchorId, window) challenge,
// and hand an `AnchorProof` to `AppModel` for the next claim.
//
// StepCore holds the wire types + challenge maths (macOS-buildable). The radio
// and camera readers live here behind `#if canImport(...)`: CoreBluetooth
// (BLE), CoreNFC (NFC), AVFoundation (QR). On platforms without a transport the
// reader is simply absent and the UI offers the ones that exist — mining still
// works without any anchor (a lower proof tier), never silently blocked.
//
// Accessibility: every state has a VoiceOver label + announcement, Dynamic Type
// throughout, status conveyed by text (not colour alone), 44pt targets.
import SwiftUI
import os
import StepCore

private let anchorLog = Logger(subsystem: "app.step.miner", category: "anchor")

/// Capture state machine shared by all transports.
@MainActor public final class AnchorCaptureModel: ObservableObject {
    public enum Phase: Equatable {
        case idle
        case scanning(AnchorKind)
        case captured(AnchorProof)
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .idle
    private let minerAddress: String
    private let nonceHash: String
    private var task: Task<Void, Never>?

    /// `minerAddress` and the claim's `nonce` bind the proof so it cannot be
    /// replayed; `nonceHash` is derived via `AnchorChallenge.nonceHash`.
    public init(minerAddress: String, nonce: String) {
        self.minerAddress = minerAddress
        self.nonceHash = AnchorChallenge.nonceHash(nonce: nonce)
    }

    /// Transports that have a reader compiled in on this platform.
    public static var availableKinds: [AnchorKind] {
        var kinds: [AnchorKind] = []
        #if canImport(AVFoundation) && os(iOS)
        kinds.append(.qr)
        #endif
        #if canImport(CoreNFC) && os(iOS)
        kinds.append(.nfc)
        #endif
        #if canImport(CoreBluetooth)
        kinds.append(.ble)
        #endif
        return kinds
    }

    public func start(_ kind: AnchorKind) {
        guard let reader = Self.reader(for: kind) else {
            phase = .failed("\(kind.rawValue.uppercased()) isn't available on this device.")
            return
        }
        task?.cancel()
        phase = .scanning(kind)
        anchorLog.info("anchor capture start kind=\(kind.rawValue, privacy: .public)")
        task = Task {
            do {
                let proof = try await reader.capture(minerAddress: minerAddress, nonceHash: nonceHash)
                if Task.isCancelled { return }
                phase = .captured(proof)
                anchorLog.info("anchor capture ok kind=\(kind.rawValue, privacy: .public)")
            } catch is CancellationError {
                // user cancelled — return to idle quietly
            } catch {
                if Task.isCancelled { return }
                phase = .failed(Self.message(error))
                anchorLog.error("anchor capture failed kind=\(kind.rawValue, privacy: .public)")
            }
        }
    }

    public func cancel() {
        task?.cancel()
        phase = .idle
    }

    private static func message(_ error: Error) -> String {
        (error as? AnchorReaderError)?.userMessage ?? "Couldn't reach the anchor. Move closer and try again."
    }

    /// Resolve the reader for a transport, or nil when it isn't compiled in.
    private static func reader(for kind: AnchorKind) -> AnchorCapturing? {
        switch kind {
        case .qr:
            #if canImport(AVFoundation) && os(iOS)
            return QRAnchorReader()
            #else
            return nil
            #endif
        case .nfc:
            #if canImport(CoreNFC) && os(iOS)
            return NFCAnchorReader()
            #else
            return nil
            #endif
        case .ble:
            #if canImport(CoreBluetooth)
            return BLEAnchorReader()
            #else
            return nil
            #endif
        }
    }
}

public enum AnchorReaderError: Error {
    case unsupported
    case timeout
    case outOfRange
    case malformed

    var userMessage: String {
        switch self {
        case .unsupported: return "This anchor type isn't supported on this device."
        case .timeout: return "Timed out waiting for the anchor. Try again."
        case .outOfRange: return "No anchor in range. Move closer to the tag or beacon."
        case .malformed: return "The anchor sent an unreadable proof."
        }
    }
}

/// Optional anchor-capture surface for the mine flow. Fully accessible; shows
/// only the transports available on the device and reports each state in text.
public struct AnchorCaptureView: View {
    @StateObject private var model: AnchorCaptureModel
    private let onCaptured: (AnchorProof) -> Void

    public init(minerAddress: String, nonce: String, onCaptured: @escaping (AnchorProof) -> Void) {
        _model = StateObject(wrappedValue: AnchorCaptureModel(minerAddress: minerAddress, nonce: nonce))
        self.onCaptured = onCaptured
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: StepSpacing.sm) {
            Text("Verify with a trusted anchor (optional)")
                .font(.headline)
            Text("Tap a nearby STEP anchor to strengthen your proof of presence. Mining still works without one.")
                .font(.caption).foregroundStyle(StepColor.textMuted)
            content
        }
        .padding(StepSpacing.md)
        .background(StepColor.surface, in: RoundedRectangle(cornerRadius: StepRadius.md))
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle, .failed:
            if case let .failed(msg) = model.phase {
                Text(msg).font(.caption).foregroundStyle(StepColor.danger)
                    .accessibilityLabel("Anchor capture failed. \(msg)")
            }
            let kinds = AnchorCaptureModel.availableKinds
            if kinds.isEmpty {
                Text("No anchor readers are available on this device.")
                    .font(.caption).foregroundStyle(StepColor.textMuted)
            } else {
                HStack(spacing: StepSpacing.sm) {
                    ForEach(kinds, id: \.self) { kind in
                        Button { model.start(kind) } label: {
                            Text(label(kind)).frame(minWidth: 44, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Scan anchor over \(label(kind))")
                    }
                }
            }
        case .scanning(let kind):
            HStack(spacing: StepSpacing.sm) {
                ProgressView()
                Text("Scanning for \(label(kind)) anchor…")
                Spacer()
                Button("Cancel") { model.cancel() }.frame(minHeight: 44)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Scanning for \(label(kind)) anchor")
            .accessibilityAddTraits(.updatesFrequently)
        case .captured(let proof):
            Label("Anchor \(short(proof.anchorId)) verified", systemImage: "checkmark.seal.fill")
                .foregroundStyle(StepColor.success)
                .accessibilityLabel("Anchor \(short(proof.anchorId)) verified via \(proof.kind.rawValue.uppercased())")
                .onAppear { onCaptured(proof) }
        }
    }

    private func label(_ kind: AnchorKind) -> String {
        switch kind {
        case .ble: return "Bluetooth"
        case .nfc: return "NFC"
        case .qr: return "QR"
        }
    }

    private func short(_ id: String) -> String {
        id.count > 12 ? "\(id.prefix(8))…\(id.suffix(4))" : id
    }
}
