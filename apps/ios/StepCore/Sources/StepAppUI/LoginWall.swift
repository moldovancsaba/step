// Login wall (M7 #27): zero-knowledge register/sign-in on GDS-parity form
// styling. The password never leaves the device (Argon2id client-side, see
// AccountVault); on success the wallet is decrypted into the KeyStore and the
// shell unlocks. Accessibility: secure fields, VoiceOver labels/errors, Dynamic
// Type, localized, ≥44pt controls; the error is announced.
import SwiftUI
import StepCore

public struct LoginWall: View {
    @ObservedObject var model: AppModel
    @State private var mode: Mode = .signIn
    @State private var identity = ""
    @State private var password = ""
    @State private var busy = false
    @FocusState private var focused: Field?

    enum Mode { case signIn, signUp }
    enum Field { case identity, password }

    public init(model: AppModel) { self.model = model }

    private var valid: Bool { identity.trimmingCharacters(in: .whitespaces).count >= 3 && password.count >= 8 }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: StepSpacing.md) {
                Text("STEP").font(.largeTitle.bold()).foregroundStyle(StepColor.text)
                Text(mode == .signIn ? "Sign in" : "Create your account")
                    .font(.title3.weight(.semibold)).foregroundStyle(StepColor.text)
                Text("Your wallet is encrypted on this device and never leaves it unencrypted. We never see your key or password.")
                    .font(.callout).foregroundStyle(StepColor.textMuted)

                field("Email or username") {
                    TextField("you@example.com", text: $identity)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .focused($focused, equals: .identity)
                }
                field("Password", hint: "Minimum 8 characters. Derives your encryption key.") {
                    SecureField("password", text: $password)
                        .textContentType(mode == .signIn ? .password : .newPassword)
                        .focused($focused, equals: .password)
                }

                if let err = model.authError {
                    Label(err, systemImage: "exclamationmark.triangle")
                        .font(.callout).foregroundStyle(StepColor.danger)
                        .accessibilityLabel("Error: \(err)")
                }

                Button {
                    Task { await submit() }
                } label: {
                    HStack {
                        if busy { ProgressView() }
                        Text(mode == .signIn ? "Sign in" : "Create account").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(StepColor.primary)
                .controlSize(.large)
                .disabled(!valid || busy)
                .accessibilityHint(mode == .signIn ? "Signs in and unlocks your wallet" : "Creates an account and wallet")

                Button(mode == .signIn ? "New to STEP? Create an account" : "Already have an account? Sign in") {
                    mode = mode == .signIn ? .signUp : .signIn
                    model.clearAuthError()
                }
                .font(.callout)
                .tint(StepColor.primary)
            }
            .padding(StepSpacing.lg)
            .textFieldStyle(.roundedBorder)
        }
        .background(StepColor.background.ignoresSafeArea())
    }

    @ViewBuilder
    private func field<Control: View>(_ label: String, hint: String? = nil, @ViewBuilder _ control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: StepSpacing.xs) {
            Text(label).font(.footnote.weight(.medium)).foregroundStyle(StepColor.textMuted)
            control()
            if let hint { Text(hint).font(.caption2).foregroundStyle(StepColor.textMuted) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        let id = identity.trimmingCharacters(in: .whitespaces)
        if mode == .signIn { await model.signIn(identity: id, password: password) }
        else { await model.register(identity: id, password: password) }
    }
}
