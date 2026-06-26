import Foundation
import Testing

@testable import StepCore

@Suite struct TrustCenterPairingTests {
    let walletKey = Data(repeating: 0x42, count: 32)
    let node = "0x1111111111111111111111111111111111111111"
    let owner = "0x2222222222222222222222222222222222222222"
    let registry = "0x3333333333333333333333333333333333333333"
    let challenge = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    @Test func validatesInstallerPayloadShape() throws {
        let payload = TrustCenterPairingPayload(nodeAddress: node, challenge: challenge)
        #expect(try payload.validated().nodeAddress == node)
    }

    @Test func rejectsWrongPairingType() throws {
        let payload = TrustCenterPairingPayload(type: "other", nodeAddress: node, challenge: challenge)
        var caught: TrustCenterPairingError?
        do { _ = try payload.validated() } catch let e as TrustCenterPairingError { caught = e }
        #expect(caught == .invalidType)
    }

    @Test func buildsSignedGatewayRequest() throws {
        let wallet = try Wallet(privateKeyData: walletKey)
        let payload = TrustCenterPairingPayload(nodeAddress: node, challenge: challenge)
        let req = try payload.request(ownerWallet: owner, wallet: wallet, registryAddress: registry, chainId: 262144, expiresAtUnix: 1_800_000_000)
        #expect(req.type == "step.trustcenter.pair")
        #expect(req.nodeAddress == node)
        #expect(req.ownerWallet == owner)
        #expect(req.signature.hasPrefix("0x"))
        #expect(Data(hexString: req.signature)?.count == 65)
    }

    @Test func pairingDigestIsStable() {
        let digest = TrustCenterPairingPayload.pairingDigest(
            nodeAddress: node,
            ownerWallet: owner,
            challenge: challenge,
            expiresAtUnix: 1_800_000_000,
            registryAddress: registry,
            chainId: 262144
        )
        #expect(digest.count == 32)
        #expect(digest.hexString == TrustCenterPairingPayload.pairingDigest(
            nodeAddress: node,
            ownerWallet: owner,
            challenge: challenge,
            expiresAtUnix: 1_800_000_000,
            registryAddress: registry,
            chainId: 262144
        ).hexString)
    }
}
