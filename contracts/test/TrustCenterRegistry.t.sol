// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TrustCenterRegistry} from "../src/TrustCenterRegistry.sol";

contract TrustCenterRegistryTest is Test {
    StepAccess internal access;
    TrustCenterRegistry internal registry;

    address internal admin = makeAddr("admin");
    uint256 internal ownerPk = 0xA11CE;
    address internal owner;
    address internal node = makeAddr("node");
    address internal other = makeAddr("other");
    bytes32 internal challenge = keccak256("pairing-challenge");
    uint64 internal expiresAt;

    function setUp() public {
        owner = vm.addr(ownerPk);
        expiresAt = uint64(block.timestamp + 1 hours);
        access = new StepAccess(admin);
        registry = new TrustCenterRegistry(access);
        bytes32 validatorAdminRole = access.VALIDATOR_ADMIN_ROLE();
        vm.prank(admin);
        access.grantRole(validatorAdminRole, admin);
    }

    function _sig(address node_, address owner_, bytes32 challenge_, uint64 expiresAt_)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.pairingDigest(node_, owner_, challenge_, expiresAt_);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    function test_pair_node_records_owner_reward_and_pending_status() public {
        vm.expectEmit(true, false, false, true);
        emit TrustCenterRegistry.NodeStatusChanged(node, TrustCenterRegistry.NodeStatus.Pending);
        registry.pairNode(node, owner, challenge, expiresAt, _sig(node, owner, challenge, expiresAt));
        assertEq(registry.nodeOwner(node), owner);
        assertEq(registry.rewardRecipient(node), owner);
        assertEq(uint8(registry.nodeStatus(node)), uint8(TrustCenterRegistry.NodeStatus.Pending));
    }

    function test_pairing_does_not_grant_activation_automatically() public {
        registry.pairNode(node, owner, challenge, expiresAt, _sig(node, owner, challenge, expiresAt));
        assertEq(uint8(registry.nodeStatus(node)), uint8(TrustCenterRegistry.NodeStatus.Pending));
    }

    function test_owner_can_set_reward_recipient() public {
        registry.pairNode(node, owner, challenge, expiresAt, _sig(node, owner, challenge, expiresAt));
        vm.prank(owner);
        registry.setRewardRecipient(node, other);
        assertEq(registry.rewardRecipient(node), other);
    }

    function test_non_owner_cannot_set_reward_recipient() public {
        registry.pairNode(node, owner, challenge, expiresAt, _sig(node, owner, challenge, expiresAt));
        vm.expectRevert(abi.encodeWithSelector(TrustCenterRegistry.NotNodeOwner.selector, node, other));
        vm.prank(other);
        registry.setRewardRecipient(node, other);
    }

    function test_wrong_signature_rejected() public {
        bytes memory sig = _sig(node, owner, challenge, expiresAt);
        vm.expectRevert();
        registry.pairNode(node, other, challenge, expiresAt, sig);
    }

    function test_replay_rejected() public {
        bytes memory sig = _sig(node, owner, challenge, expiresAt);
        registry.pairNode(node, owner, challenge, expiresAt, sig);
        vm.expectRevert();
        registry.pairNode(node, owner, challenge, expiresAt, sig);
    }

    function test_expired_pairing_rejected() public {
        bytes memory sig = _sig(node, owner, challenge, expiresAt);
        vm.warp(expiresAt + 1);
        vm.expectRevert();
        registry.pairNode(node, owner, challenge, expiresAt, sig);
    }

    function test_admin_can_update_status() public {
        vm.prank(admin);
        registry.setNodeStatus(node, TrustCenterRegistry.NodeStatus.Active);
        assertEq(uint8(registry.nodeStatus(node)), uint8(TrustCenterRegistry.NodeStatus.Active));
    }
}
