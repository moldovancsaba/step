import Foundation
import Testing

@testable import StepCore

@Suite struct MarketplaceTests {
    @Test func decodesListings() throws {
        let json = """
        [{"token_id":"7","seller":"0xabc","price_trinity":"1000000","active":true,"listed_at_block":"42"}]
        """
        let listings = try JSONDecoder().decode([Listing].self, from: Data(json.utf8))
        #expect(listings.count == 1)
        #expect(listings[0].tokenId == "7")
        #expect(listings[0].priceTrinity == "1000000")
        #expect(listings[0].active)
    }

    @Test func decodesTrades() throws {
        let json = """
        [{"kind":"sale","token_id":"7","from":"0xa","to":"0xb","price_trinity":"5","block_number":"99","tx_hash":"0xdead"},
         {"kind":"cancel","token_id":"7","from":null,"to":null,"price_trinity":null,"block_number":"100","tx_hash":"0xbeef"}]
        """
        let trades = try JSONDecoder().decode([Trade].self, from: Data(json.utf8))
        #expect(trades.count == 2)
        #expect(trades[0].kind == "sale")
        #expect(trades[0].priceTrinity == "5")
        #expect(trades[1].from == nil)
        #expect(trades[1].kind == "cancel")
    }

    @Test func revertReasonsMapToFriendlyCopy() {
        #expect(MarketplaceWriteError.reverted("SelfBuy()").userMessage.contains("your own"))
        #expect(MarketplaceWriteError.reverted("PriceTooLow()").userMessage.contains("at least 1"))
        #expect(MarketplaceWriteError.reverted("SellerNoLongerOwns()").userMessage.contains("stale"))
        #expect(MarketplaceWriteError.reverted("EnforcedPause()").userMessage.contains("paused"))
        #expect(MarketplaceWriteError.notDeployed.userMessage.contains("deployed"))
    }
}
