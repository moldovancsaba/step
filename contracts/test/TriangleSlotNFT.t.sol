// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TriangleSlotNFT} from "../src/TriangleSlotNFT.sol";

contract TriangleSlotNFTTest is Test {
    StepAccess internal access;
    TriangleSlotNFT internal nft;
    address internal admin = makeAddr("admin");
    address internal verifier = makeAddr("verifier"); // stands in for MiningClaimVerifier
    address internal miner = makeAddr("miner");
    address internal other = makeAddr("other");

    bytes32 internal constant TRI_A = keccak256("STEP-21-F00-12203302320201032103");
    bytes32 internal constant TRI_B = keccak256("STEP-21-F07-03210320312030120312");

    function setUp() public {
        access = new StepAccess(admin);
        nft = new TriangleSlotNFT(access);
        bytes32 minterRole = access.NFT_MINTER_ROLE();
        vm.prank(admin);
        access.grantRole(minterRole, verifier);
    }

    function _mint(bytes32 tri, uint32 slot, address to) internal returns (uint256) {
        vm.prank(verifier);
        return nft.mintSlot(to, tri, 21, slot, uint64(block.timestamp));
    }

    function test_mint_records_provenance_and_owner() public {
        uint256 id = _mint(TRI_A, 0, miner);
        assertEq(nft.ownerOf(id), miner);
        TriangleSlotNFT.SlotProvenance memory p = nft.provenance(id);
        assertEq(p.triangleIdHash, TRI_A);
        assertEq(p.level, 21);
        assertEq(p.slot, 0);
        assertEq(p.originalMiner, miner);
        assertEq(p.minedAt, uint64(block.timestamp));
        assertEq(nft.slot0Owner(TRI_A), miner);
        assertEq(id, nft.tokenIdFor(TRI_A, 0));
    }

    function test_only_minter_role_can_mint() public {
        vm.prank(other);
        vm.expectRevert();
        nft.mintSlot(miner, TRI_A, 21, 0, uint64(block.timestamp));
    }

    function test_duplicate_slot_reverts() public {
        _mint(TRI_A, 0, miner);
        vm.prank(verifier);
        vm.expectRevert(
            abi.encodeWithSelector(TriangleSlotNFT.SlotAlreadyMinted.selector, TRI_A, uint32(0))
        );
        nft.mintSlot(other, TRI_A, 21, 0, uint64(block.timestamp));
    }

    function test_token_ids_distinct_across_triangle_and_slot() public {
        uint256 a0 = _mint(TRI_A, 0, miner);
        uint256 a1 = _mint(TRI_A, 1, miner);
        uint256 b0 = _mint(TRI_B, 0, miner);
        assertTrue(a0 != a1 && a0 != b0 && a1 != b0);
    }

    function testFuzz_tokenId_distinct(bytes32 t1, uint32 s1, bytes32 t2, uint32 s2) public {
        vm.assume(t1 != t2 || s1 != s2);
        assertTrue(nft.tokenIdFor(t1, s1) != nft.tokenIdFor(t2, s2));
    }

    function test_transfer_moves_ownership_and_slot0owner() public {
        uint256 id = _mint(TRI_A, 0, miner);
        vm.prank(miner);
        nft.transferFrom(miner, other, id);
        assertEq(nft.ownerOf(id), other);
        // Provenance (originalMiner) is immutable even after transfer.
        assertEq(nft.provenance(id).originalMiner, miner);
        // Landlord (slot-0 owner) follows current ownership.
        assertEq(nft.slot0Owner(TRI_A), other);
    }

    function test_slot0Owner_zero_when_unminted() public {
        assertEq(nft.slot0Owner(TRI_B), address(0));
    }

    function test_provenance_unknown_token_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(TriangleSlotNFT.UnknownToken.selector, uint256(123)));
        nft.provenance(123);
    }
}
