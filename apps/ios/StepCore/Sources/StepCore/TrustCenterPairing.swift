import Foundation

public enum TrustCenterPairingError: Error, Equatable {
    case invalidType
    case invalidVersion
    case invalidAddress(String)
    case invalidChallenge
    case expired
}

public struct TrustCenterPairingPayload: Codable, Equatable, Sendable {
    public let type: String
    public let version: Int
    public let nodeAddress: String
    public let platform: String?
    public let agentVersion: String?
    public let registry: String?
    public let chainId: String?
    public let challenge: String
    public let createdAt: String?
    public let expiresAt: String?

    public init(
        type: String = "step.trustcenter.pair",
        version: Int = 1,
        nodeAddress: String,
        platform: String? = nil,
        agentVersion: String? = nil,
        registry: String? = nil,
        chainId: String? = nil,
        challenge: String,
        createdAt: String? = nil,
        expiresAt: String? = nil
    ) {
        self.type = type
        self.version = version
        self.nodeAddress = nodeAddress
        self.platform = platform
        self.agentVersion = agentVersion
        self.registry = registry
        self.chainId = chainId
        self.challenge = challenge
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }

    public static func decode(_ data: Data) throws -> TrustCenterPairingPayload {
        try JSONDecoder().decode(TrustCenterPairingPayload.self, from: data)
    }

    public func validated(now: Date = Date()) throws -> TrustCenterPairingPayload {
        guard type == "step.trustcenter.pair" else { throw TrustCenterPairingError.invalidType }
        guard version == 1 else { throw TrustCenterPairingError.invalidVersion }
        guard TrustCenterPairingPayload.isAddress(nodeAddress) else {
            throw TrustCenterPairingError.invalidAddress(nodeAddress)
        }
        guard Data(hexString: challenge)?.count == 32 else { throw TrustCenterPairingError.invalidChallenge }
        if let expiresAt, let expiry = ISO8601DateFormatter().date(from: expiresAt), expiry <= now {
            throw TrustCenterPairingError.expired
        }
        return self
    }

    public func request(ownerWallet: String, wallet: Wallet, registryAddress: String, chainId: UInt64, expiresAtUnix: UInt64) throws -> TrustCenterPairRequest {
        let payload = try validated()
        guard TrustCenterPairingPayload.isAddress(ownerWallet) else {
            throw TrustCenterPairingError.invalidAddress(ownerWallet)
        }
        guard TrustCenterPairingPayload.isAddress(registryAddress) else {
            throw TrustCenterPairingError.invalidAddress(registryAddress)
        }
        let digest = TrustCenterPairingPayload.pairingDigest(
            nodeAddress: payload.nodeAddress,
            ownerWallet: ownerWallet,
            challenge: payload.challenge,
            expiresAtUnix: expiresAtUnix,
            registryAddress: registryAddress,
            chainId: chainId
        )
        let signature = try wallet.sign(digest: TrustCenterPairingPayload.ethSignedMessageDigest(digest))
        return TrustCenterPairRequest(
            type: payload.type,
            version: payload.version,
            nodeAddress: payload.nodeAddress.lowercased(),
            ownerWallet: ownerWallet.lowercased(),
            challenge: payload.challenge.lowercased(),
            expiresAt: expiresAtUnix,
            signature: signature.hexString
        )
    }

    public static func pairingDigest(
        nodeAddress: String,
        ownerWallet: String,
        challenge: String,
        expiresAtUnix: UInt64,
        registryAddress: String,
        chainId: UInt64
    ) -> Data {
        let domain = TrustCenterPairingPayload.bytes32Word(Keccak.hash256(utf8: "STEP_TRUST_CENTER_PAIR_V1"))
        let encoded =
            domain
            + TrustCenterPairingPayload.uint256Word(chainId)
            + TrustCenterPairingPayload.addressWord(registryAddress)
            + TrustCenterPairingPayload.addressWord(nodeAddress)
            + TrustCenterPairingPayload.addressWord(ownerWallet)
            + TrustCenterPairingPayload.bytes32Word(Data(hexString: challenge) ?? Data())
            + TrustCenterPairingPayload.uint256Word(expiresAtUnix)
        return Keccak.hash256(encoded)
    }

    public static func ethSignedMessageDigest(_ digest: Data) -> Data {
        var data = Data("\u{19}Ethereum Signed Message:\n32".utf8)
        data.append(digest)
        return Keccak.hash256(data)
    }

    static func isAddress(_ value: String) -> Bool {
        let hex = value.hasPrefix("0x") ? String(value.dropFirst(2)) : value
        return hex.count == 40 && hex.allSatisfy { $0.isHexDigit }
    }

    private static func uint256Word(_ value: UInt64) -> Data {
        AbiValue.leftPad(Rlp.minimalBytes(value))
    }

    private static func addressWord(_ value: String) -> Data {
        AbiValue.leftPad((Data(hexString: value) ?? Data()).suffix(20))
    }

    private static func bytes32Word(_ value: Data) -> Data {
        AbiValue.leftPad(value)
    }
}

public struct TrustCenterPairRequest: Codable, Equatable, Sendable {
    public let type: String
    public let version: Int
    public let nodeAddress: String
    public let ownerWallet: String
    public let challenge: String
    public let expiresAt: UInt64
    public let signature: String

    enum CodingKeys: String, CodingKey {
        case type
        case version
        case nodeAddress
        case ownerWallet
        case challenge
        case expiresAt
        case signature
    }
}

public struct TrustCenterStatus: Codable, Equatable, Sendable {
    public let nodeAddress: String
    public let ownerWallet: String?
    public let rewardRecipient: String?
    public let status: String
    public let activeWeight: String
    public let nextAction: String
}

public extension GatewayClient {
    func pairTrustCenter(_ request: TrustCenterPairRequest) async throws -> TrustCenterStatus {
        let encoder = JSONEncoder()
        let body = try JSONSerialization.jsonObject(with: encoder.encode(request)) as? [String: Any] ?? [:]
        return try await post(gatewayURL.appendingPathComponent("v1/trust-centers/pair"), body: body)
    }

    func trustCenterStatus(nodeAddress: String) async throws -> TrustCenterStatus {
        try await get(gatewayURL.appendingPathComponent("v1/trust-centers/\(nodeAddress)"))
    }
}
