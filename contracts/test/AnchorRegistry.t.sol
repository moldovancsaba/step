// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

contract AnchorRegistryTest is Test {
    StepAccess internal access;
    AnchorRegistry internal reg;
    address internal admin = makeAddr("admin");
    address internal merchant = makeAddr("merchant");
    address internal safety = makeAddr("safety");
    address internal miner = makeAddr("miner");

    uint256 internal anchorPk = 0xA11CE;
    address internal anchorSigner;

    bytes32 internal constant ANCHOR_ID = keccak256("anchor-1");
    bytes32 internal constant TRI = keccak256("STEP-21-F00-12203302320201032103");
    bytes32 internal constant NONCE = keccak256("nonce-1");

    function setUp() public {
        access = new StepAccess(admin);
        reg = new AnchorRegistry(access);
        anchorSigner = vm.addr(anchorPk);
        bytes32 safetyRole = access.SAFETY_ROLE();
        vm.prank(admin);
        access.grantRole(safetyRole, safety);
        vm.prank(merchant);
        reg.registerAnchor(ANCHOR_ID, TRI, anchorSigner, AnchorRegistry.AnchorKind.Ble);
    }

    function _proof(address m, uint64 window, uint256 pk)
        internal
        view
        returns (AnchorRegistry.Proof memory)
    {
        bytes32 c = reg.challenge(m, NONCE, ANCHOR_ID, window);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, c);
        return AnchorRegistry.Proof({
            anchorId: ANCHOR_ID,
            miner: m,
            nonceHash: NONCE,
            proofWindow: window,
            signature: abi.encodePacked(r, s, v)
        });
    }

    function test_valid_anchor_proof() public {
        (bool present, bool valid, bytes32 tri, uint8 kind) =
            reg.verifyAnchorProof(_proof(miner, 100, anchorPk), 100, 1);
        assertTrue(present && valid);
        assertEq(tri, TRI);
        assertEq(kind, uint8(AnchorRegistry.AnchorKind.Ble));
    }

    function test_forged_signature_invalid() public {
        (bool present, bool valid,,) = reg.verifyAnchorProof(_proof(miner, 100, 0xBEEF), 100, 1);
        assertTrue(present);
        assertFalse(valid);
    }

    function test_stale_window_invalid() public {
        (, bool valid,,) = reg.verifyAnchorProof(_proof(miner, 100, anchorPk), 105, 1); // diff 5 > tol 1
        assertFalse(valid);
    }

    function test_replay_on_other_miner_invalid() public {
        // Proof signed for `miner` but submitted with miner=0xdead -> challenge differs.
        AnchorRegistry.Proof memory p = _proof(miner, 100, anchorPk);
        p.miner = address(0xdead);
        (, bool valid,,) = reg.verifyAnchorProof(p, 100, 1);
        assertFalse(valid);
    }

    function test_suspended_anchor_invalid() public {
        vm.prank(safety);
        reg.setStatus(ANCHOR_ID, AnchorRegistry.AnchorStatus.Suspended);
        (bool present, bool valid,,) = reg.verifyAnchorProof(_proof(miner, 100, anchorPk), 100, 1);
        assertTrue(present);
        assertFalse(valid);
    }

    function test_rotate_key_invalidates_old_signature() public {
        uint256 newPk = 0xB0B;
        vm.prank(merchant);
        reg.rotateKey(ANCHOR_ID, vm.addr(newPk));
        (, bool valid1,,) = reg.verifyAnchorProof(_proof(miner, 100, anchorPk), 100, 1);
        assertFalse(valid1, "old key rejected after rotation");
        (, bool valid2,,) = reg.verifyAnchorProof(_proof(miner, 100, newPk), 100, 1);
        assertTrue(valid2, "new key accepted");
    }

    function test_only_owner_rotates() public {
        vm.prank(miner);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.NotAnchorOwner.selector, ANCHOR_ID, miner));
        reg.rotateKey(ANCHOR_ID, vm.addr(0xB0B));
    }

    function test_duplicate_registration_reverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.AnchorExists.selector, ANCHOR_ID));
        reg.registerAnchor(ANCHOR_ID, TRI, anchorSigner, AnchorRegistry.AnchorKind.Qr);
    }

    function test_unregistered_anchor_not_present() public {
        AnchorRegistry.Proof memory p = _proof(miner, 100, anchorPk);
        p.anchorId = keccak256("nope");
        (bool present, bool valid,,) = reg.verifyAnchorProof(p, 100, 1);
        assertFalse(present);
        assertFalse(valid);
    }

    function test_safety_can_suspend_non_owner() public {
        vm.prank(safety);
        reg.setStatus(ANCHOR_ID, AnchorRegistry.AnchorStatus.Suspended);
        assertEq(uint8(reg.anchorOf(ANCHOR_ID).status), uint8(AnchorRegistry.AnchorStatus.Suspended));
    }
}
