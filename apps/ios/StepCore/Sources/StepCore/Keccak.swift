// Keccak-256 (the Ethereum variant: original Keccak padding 0x01, NOT SHA-3's
// 0x06). Pure Swift, no dependencies; verified against the canonical empty-
// string vector and the cross-language conformance vector in tests.
import Foundation

public enum Keccak {
    private static let roundConstants: [UInt64] = [
        0x0000_0000_0000_0001, 0x0000_0000_0000_8082, 0x8000_0000_0000_808A,
        0x8000_0000_8000_8000, 0x0000_0000_0000_808B, 0x0000_0000_8000_0001,
        0x8000_0000_8000_8081, 0x8000_0000_0000_8009, 0x0000_0000_0000_008A,
        0x0000_0000_0000_0088, 0x0000_0000_8000_8009, 0x0000_0000_8000_000A,
        0x0000_0000_8000_808B, 0x8000_0000_0000_008B, 0x8000_0000_0000_8089,
        0x8000_0000_0000_8003, 0x8000_0000_0000_8002, 0x8000_0000_0000_0080,
        0x0000_0000_0000_800A, 0x8000_0000_8000_000A, 0x8000_0000_8000_8081,
        0x8000_0000_0000_8080, 0x0000_0000_8000_0001, 0x8000_0000_8000_8008,
    ]
    private static let rotations: [[Int]] = [
        [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
        [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
    ]

    private static func keccakF(_ state: inout [UInt64]) {
        for round in 0..<24 {
            // θ
            var c = [UInt64](repeating: 0, count: 5)
            for x in 0..<5 {
                c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
            }
            for x in 0..<5 {
                let d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
                for y in 0..<5 { state[x + 5 * y] ^= d }
            }
            // ρ and π
            var b = [UInt64](repeating: 0, count: 25)
            for x in 0..<5 {
                for y in 0..<5 {
                    b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], rotations[x][y])
                }
            }
            // χ
            for x in 0..<5 {
                for y in 0..<5 {
                    state[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & b[(x + 2) % 5 + 5 * y])
                }
            }
            // ι
            state[0] ^= roundConstants[round]
        }
    }

    private static func rotl(_ v: UInt64, _ n: Int) -> UInt64 {
        n == 0 ? v : (v << n) | (v >> (64 - n))
    }

    /// keccak256 of arbitrary bytes.
    public static func hash256(_ message: [UInt8]) -> [UInt8] {
        let rate = 136 // 1088-bit rate for 256-bit output
        var padded = message
        padded.append(0x01) // Keccak (pre-SHA-3) domain padding
        while padded.count % rate != 0 { padded.append(0x00) }
        padded[padded.count - 1] |= 0x80

        var state = [UInt64](repeating: 0, count: 25)
        for blockStart in stride(from: 0, to: padded.count, by: rate) {
            for lane in 0..<(rate / 8) {
                var word: UInt64 = 0
                for b in 0..<8 {
                    word |= UInt64(padded[blockStart + lane * 8 + b]) << (8 * b)
                }
                state[lane] ^= word
            }
            keccakF(&state)
        }

        var out = [UInt8]()
        out.reserveCapacity(32)
        for lane in 0..<4 {
            for b in 0..<8 { out.append(UInt8((state[lane] >> (8 * b)) & 0xFF)) }
        }
        return out
    }

    public static func hash256(_ message: Data) -> Data { Data(hash256([UInt8](message))) }
    public static func hash256(utf8 string: String) -> Data { hash256(Data(string.utf8)) }
}

public extension Data {
    var hexString: String { "0x" + map { String(format: "%02x", $0) }.joined() }

    init?(hexString: String) {
        let hex = hexString.hasPrefix("0x") ? String(hexString.dropFirst(2)) : hexString
        guard hex.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
