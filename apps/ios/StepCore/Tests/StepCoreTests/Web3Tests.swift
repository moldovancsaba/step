import Foundation
import Testing

@testable import StepCore

@Suite struct Web3Tests {
    // MARK: ABI (vectors from `cast`)

    @Test func selectorsMatchCast() {
        #expect(Abi.selector("list(uint256,uint256)").hexNo0x == "50fd7367")
        #expect(Abi.selector("cancel(uint256)").hexNo0x == "40e58ee5")
        #expect(Abi.selector("buy(uint256)").hexNo0x == "d96a094a")
        #expect(Abi.selector("gift(uint256,address)").hexNo0x == "83a076be")
    }

    @Test func calldataMatchesCast() {
        // cast calldata 'list(uint256,uint256)' 7 1000000
        let list = Abi.calldata("list(uint256,uint256)", [.uint256("7"), .uint256("1000000")])
        #expect(list.hexNo0x == "50fd7367"
            + "0000000000000000000000000000000000000000000000000000000000000007"
            + "00000000000000000000000000000000000000000000000000000000000f4240")

        // cast calldata 'gift(uint256,address)' 7 0x1111…1111
        let gift = Abi.calldata("gift(uint256,address)", [.uint256("7"), .address("0x1111111111111111111111111111111111111111")])
        #expect(gift.hexNo0x == "83a076be"
            + "0000000000000000000000000000000000000000000000000000000000000007"
            + "0000000000000000000000001111111111111111111111111111111111111111")
    }

    // MARK: big-decimal <-> bytes

    @Test func decimalBytesRoundTrip() {
        #expect(BigUInt.decimalBytes("0").isEmpty)
        #expect(BigUInt.decimalBytes("1000000").hexNo0x == "0f4240")
        let big = "1461501637330902918203684832716283019655932542975" // 2^160 - 1
        #expect(BigUInt.decimalString(BigUInt.decimalBytes(big)) == big)
    }

    // MARK: RLP primitives

    @Test func rlpEncodesScalarsAndStrings() {
        #expect(Rlp.encode(Data()).hexNo0x == "80")           // empty string
        #expect(Rlp.encode(Data([0x00])).hexNo0x == "00")     // single low byte is itself
        #expect(Rlp.encode(Data([0x7f])).hexNo0x == "7f")
        #expect(Rlp.encode(Data([0x80])).hexNo0x == "8180")   // needs prefix
        #expect(Rlp.encode(int: 0).hexNo0x == "80")           // zero → empty string
        #expect(Rlp.encode(int: 15).hexNo0x == "0f")
        #expect(Rlp.encode(int: 1024).hexNo0x == "820400")
    }

    @Test func rlpEncodesLists() {
        // rlp(["cat","dog"]) = 0xc88363617483646f67
        let cat = Rlp.encode(Data("cat".utf8))
        let dog = Rlp.encode(Data("dog".utf8))
        #expect(Rlp.list([cat, dog]).hexNo0x == "c88363617483646f67")
        #expect(Rlp.list([]).hexNo0x == "c0") // empty list (access list)
    }

    // MARK: EIP-1559 signing

    @Test func signedTxIsTypedAndDeterministic() throws {
        let wallet = try Wallet(privateKeyData: Data(repeating: 0x42, count: 32))
        let tx = Eip1559Transaction(
            chainId: 84532, nonce: 3, maxPriorityFeePerGas: "1000000000", maxFeePerGas: "2000000000",
            gasLimit: 120_000, to: "0x1111111111111111111111111111111111111111", value: "0",
            data: Abi.calldata("buy(uint256)", [.uint256("7")])
        )
        let raw = try tx.signed(by: wallet)
        #expect(raw.hasPrefix("0x02"))                 // EIP-1559 type-2 envelope
        #expect(try tx.signed(by: wallet) == raw)      // deterministic (RFC-6979)
        #expect(tx.signingHash.count == 32)
    }
}
