import Foundation
import Testing

@testable import StepCore

@Suite struct NftClientTests {
    @Test func decodesOwnerTokensWithProvenance() throws {
        let json = """
        {"owner":"0xabc","tokens":[
          {"token_id":"1","triangle_id_hash":"0xaa","level":21,"slot":0,
           "original_miner":"0xabc","minted_at":1750000000,"owner":"0xabc"},
          {"token_id":"2","triangle_id_hash":"0xbb","level":21,"slot":4,
           "original_miner":"0xdef","minted_at":1750000100,"owner":"0xabc"}
        ]}
        """
        struct Resp: Decodable { let tokens: [NftToken] }
        let tokens = try JSONDecoder().decode(Resp.self, from: Data(json.utf8)).tokens
        #expect(tokens.count == 2)
        #expect(tokens[0].isLandlord)            // slot 0
        #expect(tokens[0].miningOrder == 1)
        #expect(!tokens[1].isLandlord)           // slot 4
        #expect(tokens[1].miningOrder == 5)
        #expect(tokens[1].level == 21)
    }
}
