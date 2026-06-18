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
    @State private var importing = false
    @State private var importedKey: Data?
    @FocusState private var focused: Field?

    enum Mode { case signIn, signUp }
    enum Field { case identity, password }

    public init(model: AppModel) { self.model = model }

    private var valid: Bool { identity.trimmingCharacters(in: .whitespaces).count >= 3 && password.count >= 8 }

    private var trimmedIdentity: String { identity.trimmingCharacters(in: .whitespaces) }
    private var trustedHere: Bool {
        model.biometricsAvailable && trimmedIdentity.count >= 3 && model.isDeviceTrusted(trimmedIdentity)
    }

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

                if trustedHere {
                    Button {
                        Task { await unlockWithDevice() }
                    } label: {
                        HStack {
                            if busy { ProgressView() }
                            Label("Unlock with this device", systemImage: "faceid").frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .disabled(busy)
                    .accessibilityHint("Uses Face ID or Touch ID to load your saved key")
                }

                Divider().padding(.vertical, StepSpacing.xs)

                Text("Have a key file? Sign in on any device by importing it with your password.")
                    .font(.caption).foregroundStyle(StepColor.textMuted)
                Button {
                    importing = true
                } label: {
                    Label("Import a key file", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(busy)

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
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            handleImport(result)
        }
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

    private func unlockWithDevice() async {
        busy = true
        defer { busy = false }
        await model.unlockFromTrustedDevice(identity: trimmedIdentity)
    }

    /// Read the picked key file (security-scoped) and unlock with the entered
    /// password. The key file alone is useless without the password.
    private func handleImport(_ result: Result<URL, Error>) {
        model.clearAuthError()
        guard password.count >= 8 else {
            model.reportAuthError("Enter your password above, then import your key file.")
            return
        }
        guard case let .success(url) = result else { return }
        let needsStop = url.startAccessingSecurityScopedResource()
        defer { if needsStop { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            model.reportAuthError("Couldn't read that key file.")
            return
        }
        let pwd = password
        Task {
            busy = true
            defer { busy = false }
            await model.unlock(fromBackupData: data, password: pwd)
        }
    }
}
