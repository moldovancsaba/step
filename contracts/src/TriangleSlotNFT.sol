// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title TriangleSlotNFT — per-slot collectible with on-chain provenance (issue #4)
/// @notice Each mined collector slot of a triangle is a unique, immutable ERC-721.
///         The slot index encodes rarity (slot 0 = the first miner of that location).
///         Minting is restricted to NFT_MINTER_ROLE (held only by the verifier).
///         Provenance is immutable; no coordinates are stored (PRV-001) — only the
///         triangle id hash, level, slot, original miner, and mined timestamp.
/// @dev    tokenId = uint256(keccak256(abi.encode(triangleIdHash, slot))) — deterministic,
///         collision-free per (triangle, slot). Geometry/metadata are resolved off-chain
///         (issue #6) from `triangleIdHash` + the canonical mesh engine.
contract TriangleSlotNFT is ERC721, StepManaged {
    struct SlotProvenance {
        bytes32 triangleIdHash; // keccak256(utf8(triangle id string)) — matches mining identity
        uint8 level; // mesh level (1..25)
        uint32 slot; // collector slot index; 0 = first miner (rarest)
        address originalMiner; // immutable first owner
        uint64 minedAt; // block timestamp at mint
    }

    /// @notice Immutable provenance per token.
    mapping(uint256 => SlotProvenance) public provenanceOf;
    /// @notice triangleIdHash -> slot -> tokenId (0 if that slot is unminted).
    mapping(bytes32 => mapping(uint32 => uint256)) public slotToken;
    /// @notice Optional base URI for tokenURI (points at the metadata service, issue #6).
    string private _baseTokenURI;

    event SlotMinted(
        uint256 indexed tokenId,
        bytes32 indexed triangleIdHash,
        uint32 slot,
        uint8 level,
        address indexed miner,
        uint64 minedAt
    );
    event BaseUriSet(string baseURI);

    error SlotAlreadyMinted(bytes32 triangleIdHash, uint32 slot);
    error UnknownToken(uint256 tokenId);

    constructor(StepAccess access_) ERC721("STEP Triangle Slot", "STEPTRI") StepManaged(access_) {}

    /// @notice Deterministic token id for a (triangle, slot) pair.
    function tokenIdFor(bytes32 triangleIdHash, uint32 slot) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(triangleIdHash, slot)));
    }

    /// @notice Mint the collectible for a consumed slot. Verifier-only; one per (triangle, slot).
    function mintSlot(address to, bytes32 triangleIdHash, uint8 level, uint32 slot, uint64 minedAt)
        external
        onlyStepRole(ACCESS.NFT_MINTER_ROLE())
        returns (uint256 tokenId)
    {
        if (slotToken[triangleIdHash][slot] != 0) {
            revert SlotAlreadyMinted(triangleIdHash, slot);
        }
        tokenId = tokenIdFor(triangleIdHash, slot);
        provenanceOf[tokenId] = SlotProvenance({
            triangleIdHash: triangleIdHash,
            level: level,
            slot: slot,
            originalMiner: to,
            minedAt: minedAt
        });
        slotToken[triangleIdHash][slot] = tokenId;
        _safeMint(to, tokenId);
        emit SlotMinted(tokenId, triangleIdHash, slot, level, to, minedAt);
    }

    /// @notice Owner of the slot-0 token of a triangle, or address(0) if unminted (landlord, #9).
    function slot0Owner(bytes32 triangleIdHash) external view returns (address) {
        uint256 id = slotToken[triangleIdHash][0];
        if (id == 0) return address(0);
        return _ownerOf(id);
    }

    function setBaseURI(string calldata baseURI) external onlyStepRole(ACCESS.DEFAULT_ADMIN_ROLE()) {
        _baseTokenURI = baseURI;
        emit BaseUriSet(baseURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function provenance(uint256 tokenId) external view returns (SlotProvenance memory) {
        if (provenanceOf[tokenId].minedAt == 0) revert UnknownToken(tokenId);
        return provenanceOf[tokenId];
    }
}
