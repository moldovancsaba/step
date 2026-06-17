// On-chain marketplace actions (M7 #30): list / cancel / buy / gift triangle
// slot NFTs via TriangleMarketplace (#8), signed by the in-memory wallet. Every
// action simulates first (eth_call) so reverts — SellerNoLongerOwns, SelfBuy,
// PriceTooLow, market paused — surface without spending gas. Buy ensures a
// Trinity allowance; list ensures NFT approval. Testnet only (Trinity has no
// monetary value); never auto-retries a sent tx (idempotent via on-chain state).
import Foundation

/// Deployed contract addresses for a testnet. These land with the #5 verifier-
/// integration deploy; until then the marketplace UI shows a "not yet deployed"
/// state rather than offering actions.
public struct MarketplaceAddresses: Sendable, Equatable {
    public let marketplace: String
    public let nft: String
    public let trinity: String
    public init(marketplace: String, nft: String, trinity: String) {
        self.marketplace = marketplace
        self.nft = nft
        self.trinity = trinity
    }
}

public enum MarketplaceWriteError: Error, Equatable {
    case reverted(String)   // decoded revert reason
    case notDeployed
    case rpc(String)

    public var userMessage: String {
        switch self {
        case .reverted(let reason): return Self.friendly(reason)
        case .notDeployed: return "The marketplace isn't deployed on this network yet."
        case .rpc(let msg): return "Network error: \(msg)"
        }
    }

    /// Map known contract reverts to actionable copy.
    static func friendly(_ reason: String) -> String {
        let r = reason.lowercased()
        if r.contains("pause") { return "The marketplace is paused right now. Try again later." }
        if r.contains("sellernolongerowns") { return "That listing is stale — the seller no longer owns it." }
        if r.contains("selfbuy") { return "You can't buy your own listing." }
        if r.contains("pricetoolow") { return "Price must be at least 1 Trinity." }
        if r.contains("allowance") || r.contains("insufficient") { return "Not enough Trinity, or approval is missing." }
        return reason.isEmpty ? "The transaction would revert." : reason
    }
}

public struct MarketplaceWriter: Sendable {
    let rpc: JsonRpcClient
    let addresses: MarketplaceAddresses
    let wallet: Wallet

    public init(rpc: JsonRpcClient, addresses: MarketplaceAddresses, wallet: Wallet) {
        self.rpc = rpc
        self.addresses = addresses
        self.wallet = wallet
    }

    // MARK: actions

    public func list(tokenId: String, priceTrinity: String) async throws -> String {
        try await ensureNftApproval()
        let data = Abi.calldata("list(uint256,uint256)", [.uint256(tokenId), .uint256(priceTrinity)])
        return try await send(to: addresses.marketplace, data: data)
    }

    public func cancel(tokenId: String) async throws -> String {
        let data = Abi.calldata("cancel(uint256)", [.uint256(tokenId)])
        return try await send(to: addresses.marketplace, data: data)
    }

    public func buy(tokenId: String, priceTrinity: String) async throws -> String {
        try await ensureTrinityAllowance(at_least: priceTrinity)
        let data = Abi.calldata("buy(uint256)", [.uint256(tokenId)])
        return try await send(to: addresses.marketplace, data: data)
    }

    public func gift(tokenId: String, to recipient: String) async throws -> String {
        let data = Abi.calldata("gift(uint256,address)", [.uint256(tokenId), .address(recipient)])
        return try await send(to: addresses.marketplace, data: data)
    }

    // MARK: approvals

    /// Ensure the marketplace is approved for all of the miner's NFTs (one-time).
    private func ensureNftApproval() async throws {
        let check = Abi.calldata("isApprovedForAll(address,address)", [.address(wallet.address), .address(addresses.marketplace)])
        let result = try await rpc.call(to: addresses.nft, data: check, from: wallet.address)
        if result.last == 1 { return } // already approved
        let data = Abi.calldata("setApprovalForAll(address,bool)", [.address(addresses.marketplace), .bool(true)])
        _ = try await send(to: addresses.nft, data: data)
    }

    /// Ensure the marketplace has a Trinity allowance covering the price.
    private func ensureTrinityAllowance(at_least price: String) async throws {
        let check = Abi.calldata("allowance(address,address)", [.address(wallet.address), .address(addresses.marketplace)])
        let result = try await rpc.call(to: addresses.trinity, data: check, from: wallet.address)
        let current = BigUInt.decimalString(result.suffix(32))
        if compareDecimal(current, price) >= 0 { return }
        let data = Abi.calldata("approve(address,uint256)", [.address(addresses.marketplace), .uint256(price)])
        _ = try await send(to: addresses.trinity, data: data)
    }

    // MARK: send (simulate → sign → broadcast)

    private func send(to: String, data: Data) async throws -> String {
        // 1. Simulate — surfaces reverts without gas.
        do {
            _ = try await rpc.call(to: to, data: data, from: wallet.address)
        } catch let GatewayError.http(_, body) {
            throw MarketplaceWriteError.reverted(body)
        }
        // 2. Build the EIP-1559 tx.
        let chainId = try await rpc.chainId()
        let nonce = try await rpc.transactionCount(wallet.address)
        let tip = try await rpc.maxPriorityFee()
        let base = try await rpc.baseFee()
        let maxFee = addDecimal(mulDecimal(base, "2"), tip) // 2*base + tip headroom
        let gas = (try? await rpc.estimateGas(from: wallet.address, to: to, data: data)) ?? 300_000
        let tx = Eip1559Transaction(
            chainId: chainId, nonce: nonce, maxPriorityFeePerGas: tip, maxFeePerGas: maxFee,
            gasLimit: gas + gas / 5, to: to, value: "0", data: data
        )
        // 3. Sign + broadcast (never auto-retried).
        do {
            return try await rpc.sendRawTransaction(try tx.signed(by: wallet))
        } catch let GatewayError.http(_, body) {
            throw MarketplaceWriteError.rpc(body)
        }
    }

    // MARK: decimal helpers (avoid floating point on token amounts)

    private func compareDecimal(_ a: String, _ b: String) -> Int {
        let x = BigUInt.decimalBytes(a), y = BigUInt.decimalBytes(b)
        if x.count != y.count { return x.count < y.count ? -1 : 1 }
        for (p, q) in zip(x, y) where p != q { return p < q ? -1 : 1 }
        return 0
    }

    private func addDecimal(_ a: String, _ b: String) -> String {
        BigUInt.decimalString(addBytes(BigUInt.decimalBytes(a), BigUInt.decimalBytes(b)))
    }

    private func mulDecimal(_ a: String, _ times: String) -> String {
        let n = Int(times) ?? 1
        var acc = "0"
        for _ in 0..<n { acc = addDecimal(acc, a) }
        return acc
    }

    private func addBytes(_ a: Data, _ b: Data) -> Data {
        let x = Array(a.reversed()), y = Array(b.reversed())
        var out: [UInt8] = []
        var carry = 0
        for i in 0..<max(x.count, y.count) {
            let sum = (i < x.count ? Int(x[i]) : 0) + (i < y.count ? Int(y[i]) : 0) + carry
            out.append(UInt8(sum & 0xff))
            carry = sum >> 8
        }
        if carry > 0 { out.append(UInt8(carry)) }
        return Data(out.reversed())
    }
}
