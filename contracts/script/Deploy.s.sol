// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TrinityToken} from "../src/TrinityToken.sol";
import {MeshRegistry} from "../src/MeshRegistry.sol";
import {SafetyRegistry} from "../src/SafetyRegistry.sol";
import {ValidatorRegistry} from "../src/ValidatorRegistry.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";
import {IntegrityAttestation} from "../src/IntegrityAttestation.sol";
import {TrustCenterRegistry} from "../src/TrustCenterRegistry.sol";
import {TriangleMiningState} from "../src/TriangleMiningState.sol";
import {FoundationTreasury} from "../src/FoundationTreasury.sol";
import {ProofRegistry} from "../src/ProofRegistry.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {RewardPool} from "../src/RewardPool.sol";
import {MiningClaimVerifier} from "../src/MiningClaimVerifier.sol";

/// @notice Deploys the full STEP alpha system to Anvil / the internal testnet
///         (ADR-006) with alpha parameter defaults mirroring
///         config/protocol-params.alpha.json, and writes the address book to
///         deployments/<chainid>.json.
///
///         Env: DEPLOYER_PRIVATE_KEY (broadcaster, becomes admin),
///         optional STEP_PARAM_DELAY (seconds, default 86400).
///
///         Production note: MINTER_ROLE is granted ONLY to the verifier and
///         treasury contracts (TOK-002 natural-supply rule). Test fixtures may
///         grant a seeder for simulated pre-existing Trinity; this script never
///         does.
contract Deploy is Script {
    // Storage (not locals) to stay within stack limits.
    StepAccess internal access;
    TrinityToken internal token;
    MeshRegistry internal mesh;
    SafetyRegistry internal safety;
    ValidatorRegistry internal validators;
    ReleaseRegistry internal releases;
    IntegrityAttestation internal integrity;
    TrustCenterRegistry internal trustCenters;
    TriangleMiningState internal state;
    FoundationTreasury internal treasury;
    ProofRegistry internal proofs;
    CampaignRegistry internal campaigns;
    RewardPool internal pool;
    MiningClaimVerifier internal verifier;

    // Alpha defaults (UNFROZEN protocol parameters, ADR-003/007/008).
    uint32 internal constant SLOTS = 27;
    uint256 internal constant BASE_REWARD = 67_108_864; // 2^26 Trinity
    uint64 internal constant OPENING_DELAY = 0; // pilot config
    uint64 internal constant COOLDOWN = 3_600; // 1 h post-claim cooldown
    uint256 internal constant TWIN_BPS = 10_000; // 100% bootstrap twin
    uint256 internal constant QUORUM_WEIGHT = 100; // two protocol validators (50+50)

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        uint64 paramDelay = uint64(vm.envOr("STEP_PARAM_DELAY", uint256(86_400)));

        vm.startBroadcast(pk);

        access = new StepAccess(admin);
        token = new TrinityToken(access);
        uint8[] memory levels = new uint8[](21);
        for (uint8 i = 0; i < 21; i++) {
            levels[i] = i + 1;
        }
        mesh = new MeshRegistry(access, "step-mesh-v1", levels);
        safety = new SafetyRegistry(access);
        validators = new ValidatorRegistry(access);
        releases = new ReleaseRegistry(access);
        integrity = new IntegrityAttestation(access, validators);
        trustCenters = new TrustCenterRegistry(access);
        state = new TriangleMiningState(
            access, paramDelay, SLOTS, BASE_REWARD, OPENING_DELAY, COOLDOWN
        );
        treasury = new FoundationTreasury(access, token, paramDelay, TWIN_BPS, 0);
        proofs = new ProofRegistry(access);
        campaigns = new CampaignRegistry(access, address(treasury));
        pool = new RewardPool(access, token, campaigns);
        verifier = new MiningClaimVerifier(
            access,
            paramDelay,
            QUORUM_WEIGHT,
            token,
            mesh,
            safety,
            validators,
            state,
            treasury,
            proofs,
            pool
        );

        access.grantRole(access.VERIFIER_ROLE(), address(verifier));
        access.grantRole(access.MINTER_ROLE(), address(verifier));
        access.grantRole(access.MINTER_ROLE(), address(treasury));
        access.grantRole(access.PARAM_ROLE(), admin);
        access.grantRole(access.PAUSER_ROLE(), admin);
        access.grantRole(access.SAFETY_ROLE(), admin);
        access.grantRole(access.TREASURER_ROLE(), admin);
        access.grantRole(access.CAMPAIGN_MODERATOR_ROLE(), admin);
        access.grantRole(access.VALIDATOR_ADMIN_ROLE(), admin);
        access.grantRole(access.MESH_ADMIN_ROLE(), admin);
        // Dev: admin holds RELEASE_ROLE + INTEGRITY_ROLE directly. Production moves
        // RELEASE_ROLE to the timelock/multisig (#37) and grants INTEGRITY_ROLE to
        // node agents + the hub attestor (#36/#42).
        access.grantRole(access.RELEASE_ROLE(), admin);
        access.grantRole(access.INTEGRITY_ROLE(), admin);
        // IntegrityAttestation transitions node status on a tamper finding.
        access.grantRole(access.VALIDATOR_ADMIN_ROLE(), address(integrity));
        campaigns.setRewardPool(address(pool));

        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeAddress(json, "StepAccess", address(access));
        vm.serializeAddress(json, "TrinityToken", address(token));
        vm.serializeAddress(json, "MeshRegistry", address(mesh));
        vm.serializeAddress(json, "SafetyRegistry", address(safety));
        vm.serializeAddress(json, "ValidatorRegistry", address(validators));
        vm.serializeAddress(json, "ReleaseRegistry", address(releases));
        vm.serializeAddress(json, "IntegrityAttestation", address(integrity));
        vm.serializeAddress(json, "TrustCenterRegistry", address(trustCenters));
        vm.serializeAddress(json, "TriangleMiningState", address(state));
        vm.serializeAddress(json, "FoundationTreasury", address(treasury));
        vm.serializeAddress(json, "ProofRegistry", address(proofs));
        vm.serializeAddress(json, "CampaignRegistry", address(campaigns));
        vm.serializeAddress(json, "RewardPool", address(pool));
        vm.serializeAddress(json, "admin", admin);
        string memory out = vm.serializeAddress(json, "MiningClaimVerifier", address(verifier));
        string memory path =
            string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console.log("deployment written to %s", path);
    }
}
