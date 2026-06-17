// Reusable async content surface for every iOS screen (M7 #25): one consistent
// idle/loading/loaded/empty/error+retry contract, GDS-styled and accessible.
// Mirrors the web GDS AsyncSurface so loading/error UX is identical across
// clients. Accessibility: each phase announces itself to VoiceOver; the retry
// control is a real, labelled button (≥44pt); colour is never the only signal.
import SwiftUI

public enum LoadPhase<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value)
    case empty
    case failed(String)
}

public struct AsyncSurface<Value: Sendable, Content: View>: View {
    private let phase: LoadPhase<Value>
    private let emptyTitle: String
    private let emptyMessage: String
    private let retry: (() -> Void)?
    private let content: (Value) -> Content

    public init(
        _ phase: LoadPhase<Value>,
        emptyTitle: String = "Nothing here yet",
        emptyMessage: String = "",
        retry: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.phase = phase
        self.emptyTitle = emptyTitle
        self.emptyMessage = emptyMessage
        self.retry = retry
        self.content = content
    }

    public var body: some View {
        switch phase {
        case .idle:
            Color.clear
        case .loading:
            ProgressView()
                .controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("Loading")
        case .loaded(let value):
            content(value)
        case .empty:
            ContentUnavailableView(emptyTitle, systemImage: "tray", description: Text(emptyMessage))
                .accessibilityLabel("\(emptyTitle). \(emptyMessage)")
        case .failed(let message):
            VStack(spacing: StepSpacing.md) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(StepColor.warning)
                    .accessibilityHidden(true)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(StepColor.textMuted)
                    .multilineTextAlignment(.center)
                if let retry {
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                        .accessibilityHint("Retries the failed request")
                }
            }
            .padding(StepSpacing.lg)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Error: \(message)")
        }
    }
}
