// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {StepGovToken} from "../src/StepGovToken.sol";
import {StepGovernor} from "../src/StepGovernor.sol";

/// @notice #59 / audit C2 — operator tool to remove EOA admin from a LIVE STEP
///         deployment: deploys the TimelockController + StepGovToken + StepGovernor,
///         grants every privileged role to the timelock, makes the governor the
///         sole proposer, and renounces the deployer's roles. The invariant proven
///         by `test/GovernedHandover.t.sol` is enforced here on the real chain.
///
/// Env:
///   DEPLOYER_PRIVATE_KEY  the secret deployer/current admin (renounced at the end)
///   STEP_ACCESS           the deployed StepAccess address
///   TIMELOCK_DELAY        seconds (default 172800 = 2 days)
///   GOV_VOTING_DELAY      blocks before voting opens (default 1)
///   GOV_VOTING_PERIOD     blocks the vote stays open (default 50)
///   GOV_QUORUM_PCT        % of voting supply for quorum (default 4)
contract HandoverToGovernance is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        StepAccess access = StepAccess(vm.envAddress("STEP_ACCESS"));
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(2 days));
        uint48 vDelay = uint48(vm.envOr("GOV_VOTING_DELAY", uint256(1)));
        uint32 vPeriod = uint32(vm.envOr("GOV_VOTING_PERIOD", uint256(50)));
        uint256 quorumPct = vm.envOr("GOV_QUORUM_PCT", uint256(4));

        bytes32[] memory roles = new bytes32[](6);
        roles[0] = access.DEFAULT_ADMIN_ROLE();
        roles[1] = access.PARAM_ROLE();
        roles[2] = access.VALIDATOR_ADMIN_ROLE();
        roles[3] = access.RELEASE_ROLE();
        roles[4] = access.PAUSER_ROLE();
        roles[5] = access.GOV_ROLE();

        vm.startBroadcast(pk);

        // Governance contracts. Deployer is temporary timelock admin so it can wire
        // the governor, then renounces it.
        address[] memory proposers = new address[](0);
        address[] memory executors = new address[](1);
        executors[0] = address(0); // open execution
        TimelockController timelock = new TimelockController(delay, proposers, executors, deployer);
        StepGovToken gov = new StepGovToken(access);
        StepGovernor governor = new StepGovernor(gov, timelock, vDelay, vPeriod, 0, quorumPct);
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), deployer);

        // Hand every privileged role to the timelock, then renounce the EOA's.
        for (uint256 i = 0; i < roles.length; i++) {
            access.grantRole(roles[i], address(timelock));
        }
        for (uint256 i = 0; i < roles.length; i++) {
            access.renounceRole(roles[i], deployer);
        }
        vm.stopBroadcast();

        // Enforce the invariant before declaring success (forge prints the
        // deployed Timelock/Governor/GovToken addresses from the broadcast).
        for (uint256 i = 0; i < roles.length; i++) {
            require(!access.hasRole(roles[i], deployer), "EOA still holds a privileged role");
            require(access.hasRole(roles[i], address(timelock)), "timelock missing a role");
        }
    }
}
