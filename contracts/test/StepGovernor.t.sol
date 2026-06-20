// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";
import {StepGovToken} from "../src/StepGovToken.sol";
import {StepGovernor} from "../src/StepGovernor.sol";

/// @notice #55 — DAO governance: the privileged power to authorize a release is
///         held by a weighted on-chain vote behind a timelock, not an admin key.
///         Proves the end-to-end flow propose → vote → queue → execute publishes a
///         release through the timelock, and that a vote without quorum cannot.
contract StepGovernorTest is Test {
    StepAccess internal access;
    ReleaseRegistry internal reg;
    StepGovToken internal gov;
    TimelockController internal timelock;
    StepGovernor internal governor;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice"); // large voter
    address internal bob = makeAddr("bob"); // small voter

    bytes32 internal constant PLAT = keccak256("darwin-arm64");
    bytes32 internal constant B1 = keccak256("bin-1");
    bytes32 internal constant P1 = keccak256("params-1");
    bytes32 internal constant C1 = keccak256("config-1");

    uint48 internal constant VOTING_DELAY = 1; // blocks
    uint32 internal constant VOTING_PERIOD = 50; // blocks
    uint256 internal constant DELAY = 2 days;

    function setUp() public {
        access = new StepAccess(admin);
        reg = new ReleaseRegistry(access);
        gov = new StepGovToken(access);

        // Timelock: this test contract is temporary admin so it can wire the
        // governor as proposer; executors open (address(0)).
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        timelock = new TimelockController(DELAY, proposers, executors, address(this));

        governor = new StepGovernor(gov, timelock, VOTING_DELAY, VOTING_PERIOD, 0, 4);

        // Governor is the sole proposer/canceller on the timelock.
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        // RELEASE_ROLE lives on the timelock — no bare key can publish.
        bytes32 releaseRole = access.RELEASE_ROLE();
        vm.prank(admin);
        access.grantRole(releaseRole, address(timelock));

        // Voting power: admin (GOV_ROLE) mints, voters self-delegate.
        vm.startPrank(admin);
        access.grantRole(access.GOV_ROLE(), admin);
        gov.mint(alice, 100);
        gov.mint(bob, 1);
        vm.stopPrank();
        vm.prank(alice);
        gov.delegate(alice);
        vm.prank(bob);
        gov.delegate(bob);

        // Advance a block so the delegation snapshot is in the past.
        vm.roll(block.number + 1);
    }

    function _publishCalldata() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            ReleaseRegistry.publishRelease.selector, PLAT, uint64(1 << 32), B1, P1, C1, uint64(0)
        );
    }

    function _proposal()
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        targets[0] = address(reg);
        values = new uint256[](1);
        values[0] = 0;
        calldatas = new bytes[](1);
        calldatas[0] = _publishCalldata();
    }

    function test_DirectPublishReverts() public {
        vm.expectRevert();
        vm.prank(alice);
        reg.publishRelease(PLAT, 1 << 32, B1, P1, C1, 0);
    }

    function test_FullDaoFlowPublishesRelease() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal();
        string memory description = "publish darwin-arm64 1.0.0";
        bytes32 descHash = keccak256(bytes(description));

        vm.prank(alice);
        uint256 id = governor.propose(targets, values, calldatas, description);

        // voting opens after the delay
        vm.roll(block.number + VOTING_DELAY + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Active));

        vm.prank(alice);
        governor.castVote(id, 1); // For

        // close the vote
        vm.roll(block.number + VOTING_PERIOD + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Succeeded));

        governor.queue(targets, values, calldatas, descHash);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Queued));

        // cannot execute before the timelock delay
        vm.expectRevert();
        governor.execute(targets, values, calldatas, descHash);

        vm.warp(block.timestamp + DELAY + 1);
        governor.execute(targets, values, calldatas, descHash);

        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Executed));
        assertEq(reg.latestActive(PLAT).version, 1 << 32);
        assertTrue(reg.isAuthorized(PLAT, B1, P1, C1));
    }

    function test_DefeatedWithoutQuorumDoesNotPublish() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _proposal();
        string memory description = "publish without quorum";

        vm.prank(alice);
        uint256 id = governor.propose(targets, values, calldatas, description);
        vm.roll(block.number + VOTING_DELAY + 1);

        // only bob (weight 1 of 101 ⇒ < 4% quorum) votes For
        vm.prank(bob);
        governor.castVote(id, 1);

        vm.roll(block.number + VOTING_PERIOD + 1);
        assertEq(uint8(governor.state(id)), uint8(IGovernor.ProposalState.Defeated));

        // a defeated proposal cannot be queued
        vm.expectRevert();
        governor.queue(targets, values, calldatas, keccak256(bytes(description)));
        assertEq(reg.latestActive(PLAT).version, 0); // never published
    }
}
