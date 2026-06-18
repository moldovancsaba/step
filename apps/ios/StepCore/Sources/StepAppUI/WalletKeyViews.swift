// Self-custody key UI (M7): the "key is the authentication layer" surfaces —
// download your encrypted key backup, unlock on a new device by importing that
// file, and (opt-in) trust this device so the Secure Enclave + Face ID / Touch
// ID can auto-load the key. Mirrors the web app (`step.keybackup.v1` +
// trusted-device passkey) so a backup downloaded on either platform restores on
// the other. See KeyBackup.swift and TrustedDeviceStore.swift.
import SwiftUI
import UniformTypeIdentifiers
import StepCore

/// A JSON key-backup file for `fileExporter` / `fileImporter`.
struct KeyBackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// Wallet-tab section: download the encrypted key backup and manage whether this
/// device is trusted to auto-load the key behind Face ID / Touch ID.
struct KeyManagementSection: View {
    @ObservedObject var model: AppModel
    @State private var exporting = false
    @State private var exportDoc: KeyBackupDocument?
    @State private var exportName = "step-key.json"
    @State private var trustError: String?

    var body: some View {
        Section("Your key") {
            Text("Your key is the authentication layer for your wallet and mining. "
                 + "Download it to sign in on another device.")
                .font(.caption).foregroundStyle(StepColor.textMuted)

            Button {
                guard let backup = model.exportableBackup(), let data = try? backup.jsonData() else { return }
                exportDoc = KeyBackupDocument(data: data)
                exportName = backup.suggestedFileName
                exporting = true
            } label: {
                Label("Download key backup", systemImage: "square.and.arrow.down")
            }
            .disabled(model.exportableBackup() == nil)

            trustedDeviceControls
        }
        .fileExporter(
            isPresented: $exporting,
            document: exportDoc,
            contentType: .json,
            defaultFilename: exportName
        ) { _ in }
    }

    @ViewBuilder
    private var trustedDeviceControls: some View {
        if model.biometricsAvailable, let identity = model.signedInIdentity {
            if model.isDeviceTrusted(identity) {
                Button(role: .destructive) {
                    model.forgetTrustedDevice()
                } label: {
                    Label("Forget this device", systemImage: "lock.slash")
                }
            } else {
                Button {
                    if !model.trustThisDevice() { trustError = model.authError }
                } label: {
                    Label("Trust this device (Face ID / Touch ID)", systemImage: "faceid")
                }
            }
            if let trustError {
                Text(trustError).font(.caption).foregroundStyle(StepColor.danger)
            }
        }
    }
}
