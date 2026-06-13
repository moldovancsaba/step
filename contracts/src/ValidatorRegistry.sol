// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess, StepManaged} from "./StepAccess.sol";

/// @title ValidatorRegistry — validator identity, type, weight, stake, status
///        (SC-002, VAL-001/005/006)
/// @notice Alpha is a closed validator set (DEV §9.5): registration is
///         admin-gated. Weighted quorum (VAL-002) reads weights from here.
///         Stake/slash storage is real; open staking economics arrive post-alpha
///         (OPEN-9).
contract ValidatorRegistry is StepManaged {
    enum ValidatorType {
        MobilePeer, // weight class: lowest (SYS §12.4)
        ApprovedPoint,
        Merchant,
        Venue,
        Infrastructure,
        Protocol
    }

    enum ValidatorStatus {
        Unregistered,
        Active,
        UnderReview,
        Suspended,
        Removed
    }

    struct Validator {
        ValidatorType vtype;
        ValidatorStatus status;
        uint32 weight;
        uint256 stake;
    }

    mapping(address => Validator) public validators;

    event ValidatorRegistered(address indexed validator, uint8 validatorType, uint256 weight);
    event ValidatorStatusChanged(address indexed validator, uint8 status);
    event ValidatorWeightChanged(address indexed validator, uint256 weight);
    event ValidatorSlashed(address indexed validator, uint256 amount, bytes32 reasonCode);

    error NotRegistered(address validator);

    constructor(StepAccess access_) StepManaged(access_) {}

    function registerValidator(address addr, ValidatorType vtype, uint32 weight)
        external
        onlyStepRole(ACCESS.VALIDATOR_ADMIN_ROLE())
    {
        require(addr != address(0), "ValidatorRegistry: zero address");
        require(weight > 0, "ValidatorRegistry: zero weight");
        require(
            validators[addr].status == ValidatorStatus.Unregistered,
            "ValidatorRegistry: exists"
        );
        validators[addr] =
            Validator({vtype: vtype, status: ValidatorStatus.Active, weight: weight, stake: 0});
        emit ValidatorRegistered(addr, uint8(vtype), weight);
    }

    function setStatus(address addr, ValidatorStatus status)
        external
        onlyStepRole(ACCESS.VALIDATOR_ADMIN_ROLE())
    {
        if (validators[addr].status == ValidatorStatus.Unregistered) revert NotRegistered(addr);
        require(status != ValidatorStatus.Unregistered, "ValidatorRegistry: bad status");
        validators[addr].status = status;
        emit ValidatorStatusChanged(addr, uint8(status));
    }

    function setWeight(address addr, uint32 weight)
        external
        onlyStepRole(ACCESS.VALIDATOR_ADMIN_ROLE())
    {
        if (validators[addr].status == ValidatorStatus.Unregistered) revert NotRegistered(addr);
        require(weight > 0, "ValidatorRegistry: zero weight");
        validators[addr].weight = weight;
        emit ValidatorWeightChanged(addr, weight);
    }

    /// @notice Penalty hook (VAL-005). In alpha, stake is foundation-posted
    ///         collateral; slashing burns it to the zero ledger (recorded only).
    function slash(address addr, uint256 amount, bytes32 reasonCode)
        external
        onlyStepRole(ACCESS.SLASHER_ROLE())
    {
        Validator storage v = validators[addr];
        if (v.status == ValidatorStatus.Unregistered) revert NotRegistered(addr);
        uint256 slashed = amount > v.stake ? v.stake : amount;
        v.stake -= slashed;
        v.status = ValidatorStatus.Suspended;
        emit ValidatorSlashed(addr, slashed, reasonCode);
        emit ValidatorStatusChanged(addr, uint8(ValidatorStatus.Suspended));
    }

    /// @notice Weight if the validator may vote right now, else 0.
    function activeWeight(address addr) external view returns (uint256) {
        Validator storage v = validators[addr];
        return v.status == ValidatorStatus.Active ? v.weight : 0;
    }
}
