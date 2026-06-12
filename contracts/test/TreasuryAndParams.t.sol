// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepFixture} from "./StepFixture.sol";
import {Parameterized} from "../src/Parameterized.sol";
import {FoundationTreasury} from "../src/FoundationTreasury.sol";
import {TriangleMiningState} from "../src/TriangleMiningState.sol";

contract TreasuryAndParamsTest is StepFixture {
    function test_twin_bps_math(uint16 bpsRaw) public {
        uint256 bps = uint256(bpsRaw) % 10_001; // 0..10000
        // Schedule + timelock the twin rate change (ADR-008 governed parameter).
        bytes32 key = treasury.P_TWIN_BPS();
        vm.prank(admin);
        treasury.scheduleParam(key, bps);
        vm.warp(block.timestamp + PARAM_DELAY);
        treasury.applyParam(key);

        bytes32 ch = keccak256(abi.encode("twin", bps));
        _finaliseNatural(ch, TRI_A, miner);

        assertEq(treasury.totalTwinMinted(), (BASE_REWARD * bps) / 10_000);
    }

    function test_twin_cap_clamps_lifetime_total() public {
        // Cap below one full twin.
        uint256 cap = BASE_REWARD / 2;
        bytes32 key = treasury.P_TWIN_CAP();
        vm.prank(admin);
        treasury.scheduleParam(key, cap);
        vm.warp(block.timestamp + PARAM_DELAY);
        treasury.applyParam(key);

        _finaliseNatural(keccak256("cap-1"), TRI_A, miner);
        assertEq(treasury.totalTwinMinted(), cap, "first twin clamped to cap");

        _finaliseNatural(keccak256("cap-2"), TRI_A, miner);
        assertEq(treasury.totalTwinMinted(), cap, "no twin beyond cap");
        // Miner rewards unaffected by the cap.
        assertEq(token.balanceOf(miner), BASE_REWARD + BASE_REWARD / 2);
    }

    function test_param_timelock_enforced() public {
        bytes32 key = treasury.P_TWIN_BPS();
        vm.prank(admin);
        treasury.scheduleParam(key, 5_000);

        // Too early.
        vm.expectRevert();
        treasury.applyParam(key);

        // Non-PARAM_ROLE cannot schedule.
        vm.prank(miner);
        vm.expectRevert();
        treasury.scheduleParam(key, 1);

        vm.warp(block.timestamp + PARAM_DELAY);
        treasury.applyParam(key);
        assertEq(treasury.getParam(key), 5_000);
    }

    function test_invalid_param_values_rejected() public {
        bytes32 kBps = treasury.P_TWIN_BPS();
        bytes32 kBase = state.P_BASE_REWARD();
        bytes32 kSlots = state.P_SLOTS();
        vm.startPrank(admin);
        // bps > 100%
        vm.expectRevert();
        treasury.scheduleParam(kBps, 10_001);

        // Reward-curve invariant (HARD §4.3): base reward whose halving curve
        // drops below 1 Trinity before the last slot is invalid.
        vm.expectRevert();
        state.scheduleParam(kBase, 100); // 100 >> 26 == 0
        // Slot count too deep for current base (2^26): 28 slots → slot 27 = 0.
        vm.expectRevert();
        state.scheduleParam(kSlots, 28);
        // 27 slots with 2^26 base is the documented edge: valid.
        state.scheduleParam(kSlots, 27);
        vm.stopPrank();
    }

    function test_treasury_withdraw_role_gated_and_event_coded() public {
        _finaliseNatural(keccak256("w-1"), TRI_A, miner);
        uint256 bal = treasury.balance();
        assertGt(bal, 0);

        vm.prank(miner);
        vm.expectRevert();
        treasury.withdraw(miner, bal, "OPERATIONS");

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit FoundationTreasury.TreasuryWithdrawal(merchant, bal, "VALIDATOR_GRANTS");
        treasury.withdraw(merchant, bal, "VALIDATOR_GRANTS");
        assertEq(token.balanceOf(merchant), bal);
    }

    function test_opening_delay_and_cooldown() public {
        // Separate instance with non-zero timing parameters (MIN-004).
        TriangleMiningState timed =
            new TriangleMiningState(access, PARAM_DELAY, SLOTS, BASE_REWARD, 1000, 600);
        vm.startPrank(admin);
        access.grantRole(access.VERIFIER_ROLE(), address(this));
        vm.stopPrank();

        assertEq(
            uint8(timed.status(TRI_A)), uint8(TriangleMiningState.TriangleStatus.Locked)
        );
        vm.expectRevert();
        timed.consumeSlot(TRI_A, miner);

        vm.warp(block.timestamp + 1000);
        assertEq(uint8(timed.status(TRI_A)), uint8(TriangleMiningState.TriangleStatus.Open));
        timed.consumeSlot(TRI_A, miner);

        assertEq(
            uint8(timed.status(TRI_A)), uint8(TriangleMiningState.TriangleStatus.Cooldown)
        );
        vm.expectRevert();
        timed.consumeSlot(TRI_A, miner);

        vm.warp(block.timestamp + 600);
        timed.consumeSlot(TRI_A, miner);
        assertEq(timed.usedSlots(TRI_A), 2);
    }

    function test_token_only_minter_role() public {
        vm.prank(miner);
        vm.expectRevert();
        token.mint(miner, 1);

        vm.prank(seeder);
        vm.expectRevert("Trinity: mint below 1");
        token.mint(miner, 0);
    }

    function test_trinity_is_indivisible_zero_decimals() public {
        assertEq(token.decimals(), 0, "PRD-004: Trinity is the atomic unit");
    }
}
