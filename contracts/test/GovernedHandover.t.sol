// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {StepGovToken} from "../src/StepGovToken.sol";
import {StepGovernor} from "../src/StepGovernor.sol";

/// @notice #59 (audit C2) — proves the production handover invariant: after a
///         governed deploy, NO externally-owned account (and especially no public
///         dev key) holds privileged roles; the TimelockController holds them and
///         the StepGovernor is its sole proposer. This is the mechanical sequence
///         `scripts/chain/deploy-governed.mjs` performs on the live chain.
contract GovernedHandoverTest is Test {
    StepAccess internal access;
    TimelockController internal timelock;
    StepGovernor internal governor;

    address internal deployer = makeAddr("deployer"); // the secret EOA, renounced after
    uint256 internal constant DELAY = 2 days;

    /// The privileged roles that must end up on the timelock, not an EOA.
    function _privilegedRoles() internal view returns (bytes32[] memory r) {
        r = new bytes32[](6);
        r[0] = access.DEFAULT_ADMIN_ROLE();
        r[1] = access.PARAM_ROLE();
        r[2] = access.VALIDATOR_ADMIN_ROLE();
        r[3] = access.RELEASE_ROLE();
        r[4] = access.PAUSER_ROLE();
        r[5] = access.GOV_ROLE();
    }

    function setUp() public {
        // 1. deploy from the (secret) deployer EOA.
        vm.startPrank(deployer);
        access = new StepAccess(deployer);
        StepGovToken gov = new StepGovToken(access);
        vm.stopPrank();

        // 2. timelock + governor (this test contract is temporary timelock admin).
        address[] memory empty = new address[](0);
        address[] memory exec = new address[](1);
        exec[0] = address(0); // open execution
        timelock = new TimelockController(DELAY, empty, exec, address(this));
        governor = new StepGovernor(gov, timelock, 1, 50, 0, 4);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        // 3. governed handover: grant every privileged role to the timelock, then
        //    the deployer renounces all of them.
        bytes32[] memory roles = _privilegedRoles();
        vm.startPrank(deployer);
        for (uint256 i = 0; i < roles.length; i++) {
            access.grantRole(roles[i], address(timelock));
        }
        for (uint256 i = 0; i < roles.length; i++) {
            access.renounceRole(roles[i], deployer);
        }
        vm.stopPrank();
    }

    function test_NoEoaHoldsPrivilegedRoles() public {
        bytes32[] memory roles = _privilegedRoles();
        for (uint256 i = 0; i < roles.length; i++) {
            assertFalse(access.hasRole(roles[i], deployer), "deployer must hold no privileged role");
            assertTrue(access.hasRole(roles[i], address(timelock)), "timelock must hold the role");
        }
    }

    function test_GovernorIsTheTimelockProposer() public {
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), address(governor)));
    }

    function test_DeployerCannotGrantRolesAfterHandover() public {
        // DEFAULT_ADMIN_ROLE was renounced, so the deployer can no longer grant.
        bytes32 role = access.PARAM_ROLE();
        vm.expectRevert();
        vm.prank(deployer);
        access.grantRole(role, deployer);
    }
}
