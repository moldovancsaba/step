// Minimal web3 primitives for on-chain marketplace actions (M7 #30): RLP
// encoding, ABI calldata encoding, EIP-1559 (type-2) transaction signing, and a
// JSON-RPC client. Kept small and dependency-free; the deterministic pieces
// (RLP, ABI selectors/calldata, tx preimage) are unit-tested against `cast`
// vectors. Testnet only — Trinity has no monetary value.
import Foundation

// MARK: - RLP

public enum Rlp {
    /// RLP-encode a byte string.
    public static func encode(_ bytes: Data) -> Data {
        if bytes.count == 1, bytes[bytes.startIndex] < 0x80 { return bytes }
        return lengthPrefix(bytes.count, offset: 0x80) + bytes
    }

    /// RLP-encode a list of already-encoded items.
    public static func list(_ items: [Data]) -> Data {
        let body = items.reduce(Data(), +)
        return lengthPrefix(body.count, offset: 0xc0) + body
    }

    /// Encode a non-negative integer as a minimal big-endian byte string (no
    /// leading zeros; zero → empty), then RLP-encode it.
    public static func encode(int value: UInt64) -> Data {
        encode(minimalBytes(value))
    }

    public static func minimalBytes(_ value: UInt64) -> Data {
        if value == 0 { return Data() }
        var v = value.bigEndian
        var bytes = withUnsafeBytes(of: &v) { Data($0) }
        while bytes.first == 0 { bytes.removeFirst() }
        return bytes
    }

    private static func lengthPrefix(_ length: Int, offset: Int) -> Data {
        if length < 56 { return Data([UInt8(offset + length)]) }
        let lenBytes = minimalBytes(UInt64(length))
        return Data([UInt8(offset + 55 + lenBytes.count)]) + lenBytes
    }
}

// MARK: - ABI calldata

public enum Abi {
    /// 4-byte function selector = keccak256(signature)[0..<4].
    public static func selector(_ signature: String) -> Data {
        Keccak.hash256(utf8: signature).prefix(4)
    }

    /// Encode calldata = selector ‖ 32-byte words for each argument. Supports
    /// the argument types the marketplace needs: uint256 (decimal string) and
    /// address (hex). Order matters.
    public static func calldata(_ signature: String, _ args: [AbiValue]) -> Data {
        args.reduce(Data(selector(signature))) { $0 + $1.word }
    }
}

public enum AbiValue {
    case uint256(String) // decimal string
    case address(String) // 0x hex
    case bool(Bool)

    var word: Data {
        switch self {
        case .uint256(let dec):
            return AbiValue.leftPad(BigUInt.decimalBytes(dec))
        case .address(let hex):
            return AbiValue.leftPad((Data(hexString: hex) ?? Data()).suffix(20))
        case .bool(let b):
            return AbiValue.leftPad(Data([b ? 1 : 0]))
        }
    }

    static func leftPad(_ bytes: Data) -> Data {
        let trimmed = bytes.suffix(32)
        var word = Data(repeating: 0, count: 32)
        word.replaceSubrange((32 - trimmed.count)..<32, with: trimmed)
        return word
    }
}

/// Just enough big-unsigned-int support to turn a uint256 decimal string into
/// its minimal big-endian bytes (for ABI words and tx values).
enum BigUInt {
    /// Big-endian minimal bytes of a non-negative decimal string.
    static func decimalBytes(_ decimal: String) -> Data {
        var digits = Array(decimal.utf8).map { Int($0) - 48 }.filter { (0...9).contains($0) }
        if digits.isEmpty { return Data() }
        var out: [UInt8] = []
        // Repeated division by 256, collecting remainders (base-256 little-endian).
        while !(digits.count == 1 && digits[0] == 0) {
            var remainder = 0
            var quotient: [Int] = []
            for d in digits {
                let cur = remainder * 10 + d
                let q = cur / 256
                remainder = cur % 256
                if !(quotient.isEmpty && q == 0) { quotient.append(q) }
            }
            out.append(UInt8(remainder))
            digits = quotient.isEmpty ? [0] : quotient
        }
        return Data(out.reversed())
    }
}

// MARK: - EIP-1559 transaction

public struct Eip1559Transaction: Sendable {
    public var chainId: UInt64
    public var nonce: UInt64
    public var maxPriorityFeePerGas: String // wei decimal
    public var maxFeePerGas: String         // wei decimal
    public var gasLimit: UInt64
    public var to: String                   // 0x address
    public var value: String                // wei decimal
    public var data: Data

    public init(chainId: UInt64, nonce: UInt64, maxPriorityFeePerGas: String, maxFeePerGas: String,
                gasLimit: UInt64, to: String, value: String, data: Data) {
        self.chainId = chainId
        self.nonce = nonce
        self.maxPriorityFeePerGas = maxPriorityFeePerGas
        self.maxFeePerGas = maxFeePerGas
        self.gasLimit = gasLimit
        self.to = to
        self.value = value
        self.data = data
    }

    /// RLP-encoded fields shared by the signing preimage and the signed tx.
    private var baseFields: [Data] {
        [
            Rlp.encode(int: chainId),
            Rlp.encode(int: nonce),
            Rlp.encode(BigUInt.decimalBytes(maxPriorityFeePerGas)),
            Rlp.encode(BigUInt.decimalBytes(maxFeePerGas)),
            Rlp.encode(int: gasLimit),
            Rlp.encode((Data(hexString: to) ?? Data()).suffix(20)),
            Rlp.encode(BigUInt.decimalBytes(value)),
            Rlp.encode(data),
            Rlp.list([]), // empty access list
        ]
    }

    /// keccak256(0x02 ‖ rlp([chainId, nonce, …, accessList])) — the digest the
    /// wallet signs.
    public var signingHash: Data {
        Keccak.hash256(Data([0x02]) + Rlp.list(baseFields))
    }

    /// The signed raw transaction bytes for eth_sendRawTransaction (0x-hex).
    public func signed(by wallet: Wallet) throws -> String {
        let sig = try wallet.sign(digest: signingHash) // r(32) ‖ s(32) ‖ v(27/28)
        let r = sig.prefix(32)
        let s = sig.subdata(in: 32..<64)
        let yParity = UInt64(sig[sig.startIndex + 64] - 27) // 0 or 1
        let fields = baseFields + [
            Rlp.encode(int: yParity),
            Rlp.encode(stripLeadingZeros(r)),
            Rlp.encode(stripLeadingZeros(s)),
        ]
        let raw = Data([0x02]) + Rlp.list(fields)
        return raw.hexString
    }

    private func stripLeadingZeros(_ d: Data) -> Data {
        var out = d
        while out.first == 0 { out.removeFirst() }
        return out
    }
}

// MARK: - JSON-RPC

public struct JsonRpcClient: Sendable {
    public let url: URL
    let session: URLSession

    public init(url: URL, session: URLSession = .shared) {
        self.url = url
        self.session = session
    }

    public func chainId() async throws -> UInt64 { try await callHexInt("eth_chainId", []) }

    public func transactionCount(_ address: String) async throws -> UInt64 {
        try await callHexInt("eth_getTransactionCount", [.string(address), .string("pending")])
    }

    public func maxPriorityFee() async throws -> String {
        try await callHexBigDecimal("eth_maxPriorityFeePerGas", [])
    }

    /// base fee from the latest block header.
    public func baseFee() async throws -> String {
        let block = try await call("eth_getBlockByNumber", [.string("latest"), .bool(false)])
        guard case let .object(obj) = block, case let .string(hex)? = obj["baseFeePerGas"] else { return "0" }
        return hexToDecimal(hex)
    }

    public func estimateGas(from: String, to: String, data: Data, value: String = "0") async throws -> UInt64 {
        let tx = RpcValue.object([
            "from": .string(from), "to": .string(to),
            "value": .string("0x" + (BigUInt.decimalBytes(value).hexNo0x)),
            "data": .string(data.hexString),
        ])
        return try await callHexInt("eth_estimateGas", [tx])
    }

    /// eth_call for read/simulate; returns the raw return data.
    public func call(to: String, data: Data, from: String? = nil) async throws -> Data {
        var tx: [String: RpcValue] = ["to": .string(to), "data": .string(data.hexString)]
        if let from { tx["from"] = .string(from) }
        let result = try await call("eth_call", [.object(tx), .string("latest")])
        if case let .string(hex) = result { return Data(hexString: hex) ?? Data() }
        return Data()
    }

    public func sendRawTransaction(_ rawHex: String) async throws -> String {
        let result = try await call("eth_sendRawTransaction", [.string(rawHex)])
        if case let .string(hash) = result { return hash }
        throw GatewayError.http(0, "no tx hash in response")
    }

    public func transactionReceipt(_ txHash: String) async throws -> RpcValue? {
        let result = try await call("eth_getTransactionReceipt", [.string(txHash)])
        if case .null = result { return nil }
        return result
    }

    // MARK: transport

    private func callHexInt(_ method: String, _ params: [RpcValue]) async throws -> UInt64 {
        let result = try await call(method, params)
        guard case let .string(hex) = result else { throw GatewayError.http(0, "bad \(method)") }
        return UInt64(hex.dropFirst(2), radix: 16) ?? 0
    }

    private func callHexBigDecimal(_ method: String, _ params: [RpcValue]) async throws -> String {
        let result = try await call(method, params)
        guard case let .string(hex) = result else { return "0" }
        return hexToDecimal(hex)
    }

    private func call(_ method: String, _ params: [RpcValue]) async throws -> RpcValue {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        let body: [String: Any] = [
            "jsonrpc": "2.0", "id": 1, "method": method,
            "params": params.map(\.json),
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw GatewayError.http(status, String(data: data, encoding: .utf8) ?? "") }
        let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let err = parsed?["error"] as? [String: Any] {
            throw GatewayError.http(0, (err["message"] as? String) ?? "rpc error")
        }
        return RpcValue(json: parsed?["result"] ?? NSNull())
    }

    private func hexToDecimal(_ hex: String) -> String {
        let bytes = Data(hexString: hex) ?? Data()
        return BigUInt.decimalString(bytes)
    }
}

/// A minimal JSON value for RPC params/results.
public enum RpcValue {
    case string(String)
    case bool(Bool)
    case object([String: RpcValue])
    case array([RpcValue])
    case null

    var json: Any {
        switch self {
        case .string(let s): return s
        case .bool(let b): return b
        case .object(let o): return o.mapValues(\.json)
        case .array(let a): return a.map(\.json)
        case .null: return NSNull()
        }
    }

    init(json: Any) {
        switch json {
        case let s as String: self = .string(s)
        case let b as Bool: self = .bool(b)
        case let o as [String: Any]: self = .object(o.mapValues { RpcValue(json: $0) })
        case let a as [Any]: self = .array(a.map { RpcValue(json: $0) })
        default: self = .null
        }
    }
}

extension BigUInt {
    /// Decimal string of big-endian bytes (for surfacing wei/Trinity amounts).
    static func decimalString(_ bytes: Data) -> String {
        var digits: [Int] = [0]
        for byte in bytes {
            var carry = Int(byte)
            for i in 0..<digits.count {
                let cur = digits[i] * 256 + carry
                digits[i] = cur % 10
                carry = cur / 10
            }
            while carry > 0 { digits.append(carry % 10); carry /= 10 }
        }
        return digits.reversed().map(String.init).joined()
    }
}

extension Data {
    var hexNo0x: String { map { String(format: "%02x", $0) }.joined() }
}
