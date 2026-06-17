/**
 * Minimal event ABIs for the per-slot NFT (#4) and marketplace (#8). Kept local
 * and event-only so this indexer is decoupled from the auto-generated contract
 * ABI bundle and can project logs the moment those contracts are deployed.
 * Signatures mirror contracts/src/TriangleSlotNFT.sol and TriangleMarketplace.sol.
 */
export const TriangleSlotNftEventsAbi = [
  {
    type: "event",
    name: "SlotMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "triangleIdHash", type: "bytes32", indexed: true },
      { name: "slot", type: "uint32", indexed: false },
      { name: "level", type: "uint8", indexed: false },
      { name: "miner", type: "address", indexed: true },
      { name: "minedAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
] as const;

export const TriangleMarketplaceEventsAbi = [
  {
    type: "event",
    name: "Listed",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "priceTrinity", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Cancelled",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Sold",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "priceTrinity", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Gifted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
