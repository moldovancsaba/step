// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title TrustCenterRegistry — wallet ownership and reward routing for node identities
/// @notice Separates the human/operator wallet from the always-on Trust Center
///         machine key. Pairing proves ownership only; validator voting weight is
///         still granted explicitly through ValidatorRegistry/governance.
contract TrustCenterRegistry is StepManaged {
    using ECDSA for bytes32;

    enum NodeStatus {
        None,
        Pending,
        Active,
        Suspended,
        Revoked
    }

    mapping(address => address) public nodeOwner;
    mapping(address => address) public rewardRecipient;
    mapping(address => NodeStatus) public nodeStatus;
    mapping(bytes32 => bool) public usedPairingDigest;

    event NodePaired(address indexed node, address indexed owner, address indexed rewardRecipient);
    event RewardRecipientSet(address indexed node, address indexed recipient);
    event NodeStatusChanged(address indexed node, NodeStatus status);

    error ZeroAddress();
    error PairingExpired(uint64 expiresAt, uint64 nowTs);
    error PairingReplay(bytes32 digest);
    error InvalidOwnerSignature(address recovered, address expectedOwner);
    error NodeAlreadyOwned(address node, address owner);
    error NotNodeOwner(address node, address caller);
    error RevokedNode(address node);

    constructor(StepAccess access_) StepManaged(access_) {}

    function pairingDigest(address node, address owner, bytes32 challenge, uint64 expiresAt)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("STEP_TRUST_CENTER_PAIR_V1"),
                block.chainid,
                address(this),
                node,
                owner,
                challenge,
                expiresAt
            )
        );
    }

    /// @notice Pair a locally generated Trust Center node key to its owner wallet.
    ///         Any relayer may submit the signature. Pairing creates Pending
    ///         ownership and reward routing; it does NOT grant validator weight.
    function pairNode(
        address node,
        address owner,
        bytes32 challenge,
        uint64 expiresAt,
        bytes calldata ownerSignature
    ) external {
        if (node == address(0) || owner == address(0)) revert ZeroAddress();
        if (nodeStatus[node] == NodeStatus.Revoked) revert RevokedNode(node);
        if (block.timestamp > expiresAt) revert PairingExpired(expiresAt, uint64(block.timestamp));

        address existingOwner = nodeOwner[node];
        if (existingOwner != address(0) && existingOwner != owner) {
            revert NodeAlreadyOwned(node, existingOwner);
        }

        bytes32 digest = pairingDigest(node, owner, challenge, expiresAt);
        if (usedPairingDigest[digest]) revert PairingReplay(digest);
        address recovered = MessageHashUtils.toEthSignedMessageHash(digest).recover(ownerSignature);
        if (recovered != owner) revert InvalidOwnerSignature(recovered, owner);

        usedPairingDigest[digest] = true;
        nodeOwner[node] = owner;
        if (rewardRecipient[node] == address(0)) {
            rewardRecipient[node] = owner;
        }
        if (nodeStatus[node] == NodeStatus.None) {
            nodeStatus[node] = NodeStatus.Pending;
            emit NodeStatusChanged(node, NodeStatus.Pending);
        }
        emit NodePaired(node, owner, rewardRecipient[node]);
    }

    function setRewardRecipient(address node, address recipient) external {
        if (recipient == address(0)) revert ZeroAddress();
        if (nodeOwner[node] != msg.sender) revert NotNodeOwner(node, msg.sender);
        if (nodeStatus[node] == NodeStatus.Revoked) revert RevokedNode(node);
        rewardRecipient[node] = recipient;
        emit RewardRecipientSet(node, recipient);
    }

    function setNodeStatus(address node, NodeStatus status)
        external
        onlyStepRole(ACCESS.VALIDATOR_ADMIN_ROLE())
    {
        if (node == address(0)) revert ZeroAddress();
        nodeStatus[node] = status;
        emit NodeStatusChanged(node, status);
    }
}
