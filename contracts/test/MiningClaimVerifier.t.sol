// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepFixture} from "./StepFixture.sol";
import {MiningClaimVerifier} from "../src/MiningClaimVerifier.sol";
import {TriangleMiningState} from "../src/TriangleMiningState.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ValidatorRegistry} from "../src/ValidatorRegistry.sol";

contract MiningClaimVerifierTest is StepFixture {
    bytes32 internal constant CID = keccak256("cid");

    function test_natural_claim_mints_reward_and_twin() public {
        bytes32 claimHash = keccak256("claim-1");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 2);

        vm.expectEmit(true, true, false, true);
        emit MiningClaimVerifier.TriangleMined(TRI_A, miner, 0, BASE_REWARD, claimHash);
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);

        assertEq(token.balanceOf(miner), BASE_REWARD, "miner reward");
        assertEq(treasury.balance(), BASE_REWARD, "twin at 100% bps");
        assertEq(treasury.totalTwinMinted(), BASE_REWARD);
        assertEq(token.totalSupply(), 2 * BASE_REWARD, "supply = miner + twin");
        assertEq(state.usedSlots(TRI_A), 1);
        assertTrue(proofs.hasProof(claimHash));
    }

    function test_reward_halves_per_slot() public {
        for (uint32 s = 0; s < 5; s++) {
            bytes32 ch = keccak256(abi.encode("halving", s));
            address m = makeAddr(string(abi.encodePacked("m", s)));
            _finaliseNatural(ch, TRI_A_STRING, m);
            assertEq(token.balanceOf(m), BASE_REWARD >> s, "halving curve");
        }
    }

    function test_replay_rejected_across_both_paths() public {
        bytes32 claimHash = keccak256("claim-replay");
        _finaliseNatural(claimHash, TRI_A_STRING, miner);

        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.ClaimAlreadyFinalised.selector, claimHash)
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);

        // Same hash also blocked on the sponsored path.
        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.ClaimAlreadyFinalised.selector, claimHash)
        );
        verifier.finaliseSponsoredClaim(claimHash, TRI_A, bytes32(0), miner, CID, sigs);
    }

    function test_insufficient_quorum_rejected() public {
        bytes32 claimHash = keccak256("claim-quorum");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 1); // weight 50 < 100
        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.QuorumNotReached.selector, 50, 100)
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }

    function test_suspended_validator_contributes_no_weight() public {
        bytes32 claimHash = keccak256("claim-suspended");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 2);

        vm.prank(admin);
        validators.setStatus(valAddrs[1], ValidatorRegistry.ValidatorStatus.Suspended);

        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.QuorumNotReached.selector, 50, 100)
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }

    function test_duplicate_or_unsorted_validators_rejected() public {
        bytes32 claimHash = keccak256("claim-dup");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            new MiningClaimVerifier.ValidatorSig[](2);
        sigs[0] = _vote(valKeys[0], claimHash, TRI_A_STRING, miner, true);
        sigs[1] = _vote(valKeys[0], claimHash, TRI_A_STRING, miner, true); // duplicate

        vm.expectRevert(
            abi.encodeWithSelector(
                MiningClaimVerifier.UnsortedOrDuplicateValidator.selector, valAddrs[0]
            )
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }

    function test_signature_over_different_claim_rejected() public {
        bytes32 claimHash = keccak256("claim-x");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            new MiningClaimVerifier.ValidatorSig[](2);
        // Validator 0 signed a DIFFERENT claim hash -> recovery mismatch.
        sigs[0] = _vote(valKeys[0], keccak256("other"), TRI_A_STRING, miner, true);
        sigs[0].validator = valAddrs[0];
        sigs[1] = _vote(valKeys[1], claimHash, TRI_A_STRING, miner, true);

        vm.expectRevert(); // SignerMismatch with unpredictable recovered address
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }

    function test_rejection_votes_do_not_count() public {
        bytes32 claimHash = keccak256("claim-reject-votes");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            new MiningClaimVerifier.ValidatorSig[](2);
        // approve=false signatures do not match the approve=true digest.
        sigs[0] = _vote(valKeys[0], claimHash, TRI_A_STRING, miner, false);
        sigs[1] = _vote(valKeys[1], claimHash, TRI_A_STRING, miner, false);

        vm.expectRevert();
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }


    function test_triangle_level_mismatch_rejected() public {
        bytes32 claimHash = keccak256("claim-level-mismatch");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.TriangleLevelMismatch.selector, LEVEL + 1, LEVEL)
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL + 1, miner, CID, sigs);
    }


    function test_wallet_cannot_mine_same_triangle_twice() public {
        bytes32 first = keccak256("claim-repeat-first");
        _finaliseNatural(first, TRI_A_STRING, miner);

        bytes32 second = keccak256("claim-repeat-second");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(second, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(TriangleMiningState.WalletAlreadyMined.selector, miner, TRI_A)
        );
        verifier.finaliseNaturalClaim(second, TRI_A_STRING, LEVEL, miner, CID, sigs);
    }

    function test_malformed_triangle_id_rejected() public {
        string memory malformed = "STEP-21-F00-1220330A03201032103";
        bytes32 claimHash = keccak256("claim-malformed");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, malformed, miner, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                MiningClaimVerifier.TriangleIdMalformed.selector,
                keccak256(bytes(malformed))
            )
        );
        verifier.finaliseNaturalClaim(claimHash, malformed, LEVEL, miner, CID, sigs);
    }

    function test_frozen_triangle_rejected() public {
        vm.prank(admin);
        safety.freezeTriangle(TRI_A, "SAFETY_MILITARY");

        bytes32 claimHash = keccak256("claim-frozen");
        MiningClaimVerifier.ValidatorSig[] memory sigs =
            _quorumSigs(claimHash, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(MiningClaimVerifier.TriangleBlocked.selector, TRI_A)
        );
        verifier.finaliseNaturalClaim(claimHash, TRI_A_STRING, LEVEL, miner, CID, sigs);

        // Unfreeze restores (SAF-004). New claim hash: the frozen attempt burned one.
        vm.prank(admin);
        safety.unfreezeTriangle(TRI_A);
        _finaliseNatural(keccak256("claim-after-unfreeze"), TRI_A_STRING, miner);
        assertEq(token.balanceOf(miner), BASE_REWARD);
    }

    function test_exhaustion_after_all_slots() public {
        for (uint32 s = 0; s < SLOTS; s++) {
            address slotMiner = makeAddr(string(abi.encodePacked("ex-miner", s)));
            _finaliseNatural(keccak256(abi.encode("ex", s)), TRI_A_STRING, slotMiner);
        }
        assertEq(uint8(state.status(TRI_A)), uint8(TriangleMiningState.TriangleStatus.Exhausted));
        // Last slot paid exactly 1 Trinity (ADR-007 invariant edge).
        assertEq(state.slotReward(SLOTS - 1), 1);

        bytes32 ch = keccak256("ex-final");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(
                TriangleMiningState.TriangleNotOpen.selector,
                TRI_A,
                TriangleMiningState.TriangleStatus.Exhausted
            )
        );
        verifier.finaliseNaturalClaim(ch, TRI_A_STRING, LEVEL, miner, CID, sigs);

        // Other triangles unaffected.
        _finaliseNatural(keccak256("ex-other"), TRI_B_STRING, miner);
    }

    function test_emergency_pause_blocks_minting() public {
        bytes32 pauseMinting = access.PAUSE_MINTING();
        vm.prank(admin);
        access.setPaused(pauseMinting, true);

        bytes32 ch = keccak256("paused");
        MiningClaimVerifier.ValidatorSig[] memory sigs = _quorumSigs(ch, TRI_A_STRING, miner, 2);
        vm.expectRevert(
            abi.encodeWithSelector(StepAccess.DomainIsPaused.selector, pauseMinting)
        );
        verifier.finaliseNaturalClaim(ch, TRI_A_STRING, LEVEL, miner, CID, sigs);

        vm.prank(admin);
        access.setPaused(pauseMinting, false);
        verifier.finaliseNaturalClaim(ch, TRI_A_STRING, LEVEL, miner, CID, sigs);
        assertEq(token.balanceOf(miner), BASE_REWARD);
    }
}
