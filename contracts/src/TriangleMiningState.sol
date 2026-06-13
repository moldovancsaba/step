// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepAccess} from "./StepAccess.sol";
import {Parameterized} from "./Parameterized.sol";

/// @title TriangleMiningState — collector slots, cooldowns, exhaustion (SC-002)
/// @notice Natural-supply state machine per triangle (MIN-002/003, SYS §8).
///         Slot count and reward curve are UNFROZEN protocol parameters
///         (ADR-007): geometric halving from `P_BASE_REWARD`, with the hard
///         invariant that no slot ever yields less than 1 Trinity (HARD §4.3) —
///         enforced both at parameter validation and at consumption.
/// @dev    Triangles are lazily initialised: every triangle is "born" at
///         `GENESIS_TIME` and opens after `P_OPENING_DELAY` (MIN-004 —
///         legacy 168 h rule, parameterised).
contract TriangleMiningState is Parameterized {
    bytes32 public constant P_SLOTS = keccak256("triangle.collector_slots");
    bytes32 public constant P_BASE_REWARD = keccak256("triangle.base_reward_trinity");
    bytes32 public constant P_OPENING_DELAY = keccak256("triangle.opening_delay_s");
    bytes32 public constant P_COOLDOWN = keccak256("triangle.post_claim_cooldown_s");

    enum TriangleStatus {
        Locked, // before opening delay elapses
        Open,
        Cooldown,
        Exhausted
    }

    struct TriState {
        uint32 usedSlots;
        uint64 lastMinedAt;
    }

    uint64 public immutable GENESIS_TIME;

    mapping(bytes32 => TriState) public triangles;

    event TriangleSlotConsumed(
        bytes32 indexed triangleId, uint32 slot, uint256 rewardTrinity, address indexed miner
    );

    error TriangleNotOpen(bytes32 triangleId, TriangleStatus status);

    constructor(
        StepAccess access_,
        uint64 paramDelay_,
        uint32 slots,
        uint256 baseReward,
        uint64 openingDelay,
        uint64 cooldown
    ) Parameterized(access_, paramDelay_) {
        GENESIS_TIME = uint64(block.timestamp);
        _initParam(P_SLOTS, slots);
        _initParam(P_BASE_REWARD, baseReward);
        _initParam(P_OPENING_DELAY, openingDelay);
        _initParam(P_COOLDOWN, cooldown);
    }

    // ---- Parameterized hooks ----

    function _isKnownParam(bytes32 key) internal pure override returns (bool) {
        return key == P_SLOTS || key == P_BASE_REWARD || key == P_OPENING_DELAY
            || key == P_COOLDOWN;
    }

    function _validateParam(bytes32 key, uint256 value) internal view override {
        if (key == P_SLOTS) {
            if (value == 0 || value > 256) revert InvalidParamValue(key, value);
            // ≥1 Trinity at the last slot under the current base reward.
            uint256 base = _params[P_BASE_REWARD];
            if (base != 0 && (base >> (value - 1)) < 1) revert InvalidParamValue(key, value);
        } else if (key == P_BASE_REWARD) {
            if (value == 0) revert InvalidParamValue(key, value);
            uint256 slots = _params[P_SLOTS];
            if (slots != 0 && (value >> (slots - 1)) < 1) revert InvalidParamValue(key, value);
        }
        // Delays/cooldowns: any uint is acceptable.
    }

    // ---- Views ----

    function slotReward(uint32 slot) public view returns (uint256) {
        // Geometric halving (ADR-007 alpha default curve): slot 0 = base, then /2.
        return _params[P_BASE_REWARD] >> slot;
    }

    function status(bytes32 triangleId) public view returns (TriangleStatus) {
        TriState storage t = triangles[triangleId];
        if (t.usedSlots >= _params[P_SLOTS]) return TriangleStatus.Exhausted;
        if (block.timestamp < GENESIS_TIME + _params[P_OPENING_DELAY]) {
            return TriangleStatus.Locked;
        }
        if (t.lastMinedAt != 0 && block.timestamp < t.lastMinedAt + _params[P_COOLDOWN]) {
            return TriangleStatus.Cooldown;
        }
        return TriangleStatus.Open;
    }

    function usedSlots(bytes32 triangleId) external view returns (uint32) {
        return triangles[triangleId].usedSlots;
    }

    function nextReward(bytes32 triangleId) external view returns (uint256) {
        TriState storage t = triangles[triangleId];
        if (t.usedSlots >= _params[P_SLOTS]) return 0;
        return slotReward(t.usedSlots);
    }

    // ---- Mutations (verifier only) ----

    /// @notice Consume the next collector slot. Reverts unless the triangle is
    ///         Open. Returns the slot index and its Trinity reward (≥ 1).
    function consumeSlot(bytes32 triangleId, address miner)
        external
        onlyStepRole(ACCESS.VERIFIER_ROLE())
        whenDomainNotPaused(ACCESS.PAUSE_MINTING())
        returns (uint32 slot, uint256 reward)
    {
        TriangleStatus st = status(triangleId);
        if (st != TriangleStatus.Open) revert TriangleNotOpen(triangleId, st);
        TriState storage t = triangles[triangleId];
        slot = t.usedSlots;
        reward = slotReward(slot);
        // Defence in depth: parameter validation already guarantees this.
        require(reward >= 1, "TriangleMiningState: sub-Trinity reward");
        t.usedSlots = slot + 1;
        t.lastMinedAt = uint64(block.timestamp);
        emit TriangleSlotConsumed(triangleId, slot, reward, miner);
    }
}
