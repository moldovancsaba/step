// StepApp — the shippable iOS app target (M7 #33). Thin composition root: it
// reads endpoint configuration, builds the StepCore clients + AppModel, and
// hands them to StepAppUI's RootView. All feature code lives in the StepAppUI
// SPM product (../StepCore); this target only wires + packages it.
import SwiftUI
import StepCore
import StepAppUI

@main
struct StepApp: App {
    @StateObject private var model = AppComposition.makeModel()

    init() { Metrics.start() }

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
        }
    }
}

/// Builds the live AppModel from `AppConfig`. App Attest is wired on device; the
/// Simulator falls back to the honest unattested tier (#31).
enum AppComposition {
    @MainActor static func makeModel() -> AppModel {
        let cfg = AppConfig.current
        let attester: Attesting
        #if os(iOS) && !targetEnvironment(simulator)
        attester = AppAttestAttester()
        #else
        attester = UnattestedAttester()
        #endif

        return AppModel(
            keyStore: KeychainKeyStore(),
            client: GatewayClient(gatewayURL: cfg.gateway, meshURL: cfg.mesh),
            stateProvider: IndexerClient(indexerURL: cfg.indexer),
            account: AccountClient(baseURL: cfg.account),
            nft: NftClient(baseURL: cfg.nftIndexer),
            cover: MeshCoverClient(meshURL: cfg.mesh, indexerURL: cfg.indexer),
            market: MarketplaceClient(baseURL: cfg.nftIndexer),
            rpcURL: cfg.rpc,
            marketAddresses: cfg.marketAddresses,
            attester: attester
        )
    }
}

/// Endpoint + address configuration, read from the bundle's `StepConfig`
/// dictionary in Info.plist (overridable per build configuration / xcconfig) so
/// no secrets or environment-specific URLs are hard-coded in source.
struct AppConfig {
    let gateway: URL
    let mesh: URL
    let indexer: URL
    let account: URL
    let nftIndexer: URL
    let rpc: URL?
    let marketAddresses: MarketplaceAddresses?

    static var current: AppConfig {
        let dict = Bundle.main.object(forInfoDictionaryKey: "StepConfig") as? [String: Any] ?? [:]
        func url(_ key: String, default def: String) -> URL {
            URL(string: (dict[key] as? String) ?? def)!
        }
        let rpc = (dict["RpcURL"] as? String).flatMap(URL.init(string:))
        let market = dict["Marketplace"] as? String
        let nft = dict["MarketNft"] as? String
        let trinity = dict["Trinity"] as? String
        let addresses: MarketplaceAddresses? = (market != nil && nft != nil && trinity != nil)
            ? MarketplaceAddresses(marketplace: market!, nft: nft!, trinity: trinity!) : nil

        return AppConfig(
            gateway: url("GatewayURL", default: "https://gw.step.regiominer.com"),
            mesh: url("MeshURL", default: "https://gw.step.regiominer.com"),
            indexer: url("IndexerURL", default: "https://idx.step.regiominer.com"),
            account: url("AccountURL", default: "https://acc.step.regiominer.com"),
            nftIndexer: url("NftIndexerURL", default: "https://nft.step.regiominer.com"),
            rpc: rpc,
            marketAddresses: addresses
        )
    }
}
