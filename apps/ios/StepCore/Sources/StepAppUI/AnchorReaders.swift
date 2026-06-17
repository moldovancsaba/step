// Per-transport anchor readers (M7 #32). Each conforms to `AnchorCapturing`
// (StepCore) and is compiled only where its framework exists, so StepCore stays
// macOS-buildable and the app offers exactly the transports the device has.
//
// Anchor wire payload (what an anchor returns over any transport): JSON
// `{"anchor_id":"0x…","proof_window":<u64>,"signature":"0x…"}`. The signature
// is the anchor's signature over `AnchorChallenge.hash(miner, nonceHash,
// anchorId, window)` (== AnchorRegistry.challenge). BLE additionally accepts a
// challenge write so the anchor can sign live; NFC/QR carry a pre-signed,
// time-windowed payload (rotating QR / dynamic tag).
import Foundation
import StepCore

/// Decode the common anchor payload returned over any transport.
enum AnchorPayloadDecoder {
    struct Wire: Decodable {
        let anchorId: String
        let proofWindow: UInt64
        let signature: String
        enum CodingKeys: String, CodingKey {
            case anchorId = "anchor_id"
            case proofWindow = "proof_window"
            case signature
        }
    }

    static func decode(_ data: Data, kind: AnchorKind) throws -> AnchorProof {
        guard let wire = try? JSONDecoder().decode(Wire.self, from: data) else {
            throw AnchorReaderError.malformed
        }
        return AnchorProof(
            anchorId: wire.anchorId, kind: kind,
            proofWindow: wire.proofWindow, signatureHex: wire.signature
        )
    }
}

/// Current proof window from wall-clock time (validator tolerates ±skew).
func currentAnchorWindow() -> UInt64 {
    AnchorChallenge.window(unixSeconds: UInt64(max(0, Date().timeIntervalSince1970)))
}

#if canImport(AVFoundation) && os(iOS)
import AVFoundation

/// Scans a rotating QR encoding the anchor payload. Resolves on the first valid
/// frame; times out after 15s. The camera preview is hosted by the app target.
public final class QRAnchorReader: NSObject, AnchorCapturing, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
    private let session = AVCaptureSession()
    private var continuation: CheckedContinuation<AnchorProof, Error>?

    public override init() { super.init() }

    public func capture(minerAddress: String, nonceHash: String) async throws -> AnchorProof {
        try configureSession()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                self.continuation = cont
                self.session.startRunning()
                Task { // 15s timeout
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    self.finish(.failure(AnchorReaderError.timeout))
                }
            }
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    private func configureSession() throws {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { throw AnchorReaderError.unsupported }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { throw AnchorReaderError.unsupported }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
    }

    public func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let obj = objects.first as? AVMetadataMachineReadableCodeObject,
              let string = obj.stringValue,
              let proof = try? AnchorPayloadDecoder.decode(Data(string.utf8), kind: .qr) else { return }
        finish(.success(proof))
    }

    private func finish(_ result: Result<AnchorProof, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        if session.isRunning { session.stopRunning() }
        cont.resume(with: result)
    }
}
#endif

#if canImport(CoreNFC) && os(iOS)
import CoreNFC

/// Reads an anchor payload from an NDEF tag (first text/JSON record). Times out
/// via the system NFC session UI.
public final class NFCAnchorReader: NSObject, AnchorCapturing, NFCNDEFReaderSessionDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<AnchorProof, Error>?
    private var session: NFCNDEFReaderSession?

    public override init() { super.init() }

    public func capture(minerAddress: String, nonceHash: String) async throws -> AnchorProof {
        guard NFCNDEFReaderSession.readingAvailable else { throw AnchorReaderError.unsupported }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                self.continuation = cont
                let s = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: true)
                s.alertMessage = "Hold your iPhone near the STEP anchor."
                self.session = s
                s.begin()
            }
        } onCancel: {
            self.session?.invalidate()
            self.finish(.failure(CancellationError()))
        }
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        for record in messages.flatMap(\.records) {
            if let proof = try? AnchorPayloadDecoder.decode(record.payload, kind: .nfc) {
                finish(.success(proof)); return
            }
        }
        finish(.failure(AnchorReaderError.malformed))
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        finish(.failure(AnchorReaderError.timeout))
    }

    private func finish(_ result: Result<AnchorProof, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        cont.resume(with: result)
    }
}
#endif

#if canImport(CoreBluetooth)
import CoreBluetooth

/// Connects to a STEP anchor over BLE GATT: discovers the anchor service, reads
/// the payload characteristic (the anchor's current signed window). 15s timeout.
/// Well-known UUIDs define the anchor BLE profile (shared with merchant tooling).
public final class BLEAnchorReader: NSObject, AnchorCapturing, CBCentralManagerDelegate, CBPeripheralDelegate, @unchecked Sendable {
    public static let serviceUUID = CBUUID(string: "57544550-0000-1000-8000-00805F9B34FB") // "STEP" prefix
    public static let payloadUUID = CBUUID(string: "57544550-0001-1000-8000-00805F9B34FB")

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var continuation: CheckedContinuation<AnchorProof, Error>?

    public override init() { super.init() }

    public func capture(minerAddress: String, nonceHash: String) async throws -> AnchorProof {
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { cont in
                self.continuation = cont
                self.central = CBCentralManager(delegate: self, queue: .main)
                Task { // 15s timeout
                    try? await Task.sleep(nanoseconds: 15_000_000_000)
                    self.finish(.failure(AnchorReaderError.timeout))
                }
            }
        } onCancel: {
            self.finish(.failure(CancellationError()))
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [Self.serviceUUID])
        } else if central.state == .unsupported || central.state == .unauthorized {
            finish(.failure(AnchorReaderError.unsupported))
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        central.stopScan()
        self.peripheral = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            finish(.failure(AnchorReaderError.malformed)); return
        }
        peripheral.discoverCharacteristics([Self.payloadUUID], for: service)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let ch = service.characteristics?.first(where: { $0.uuid == Self.payloadUUID }) else {
            finish(.failure(AnchorReaderError.malformed)); return
        }
        peripheral.readValue(for: ch)
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value,
              let proof = try? AnchorPayloadDecoder.decode(data, kind: .ble) else {
            finish(.failure(AnchorReaderError.malformed)); return
        }
        finish(.success(proof))
    }

    private func finish(_ result: Result<AnchorProof, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        central?.stopScan()
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        cont.resume(with: result)
    }
}
#endif
