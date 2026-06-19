// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ValidatorRegistry} from "../src/ValidatorRegistry.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";
import {IntegrityAttestation} from "../src/IntegrityAttestation.sol";

/// @notice Additive M8 upgrade: deploy ReleaseRegistry + IntegrityAttestation
///         onto an ALREADY-DEPLOYED chain and grant their roles, WITHOUT touching
///         existing state (balances, NFTs, validator registrations). Used to land
///         the trust-update contracts on a persisted dev chain.
///
///         Env: DEPLOYER_PRIVATE_KEY (must hold DEFAULT_ADMIN_ROLE on StepAccess),
///         STEP_ACCESS, VALIDATOR_REGISTRY.
contract UpgradeM8 is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        StepAccess access = StepAccess(vm.envAddress("STEP_ACCESS"));
        ValidatorRegistry validators = ValidatorRegistry(vm.envAddress("VALIDATOR_REGISTRY"));

        vm.startBroadcast(pk);

        ReleaseRegistry releases = new ReleaseRegistry(access);
        IntegrityAttestation integrity = new IntegrityAttestation(access, validators);

        // Dev wiring: admin holds RELEASE_ROLE + INTEGRITY_ROLE; the integrity
        // contract may transition validator status. Role ids are computed locally
        // (keccak) so this works even against an older StepAccess that doesn't
        // expose the new role constants as functions.
        access.grantRole(keccak256("RELEASE_ROLE"), admin);
        access.grantRole(keccak256("INTEGRITY_ROLE"), admin);
        access.grantRole(keccak256("VALIDATOR_ADMIN_ROLE"), address(integrity));

        vm.stopBroadcast();

        console.log("ReleaseRegistry", address(releases));
        console.log("IntegrityAttestation", address(integrity));
    }
}
