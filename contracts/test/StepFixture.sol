// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {TrinityToken} from "../src/TrinityToken.sol";
import {MeshRegistry} from "../src/MeshRegistry.sol";
import {SafetyRegistry} from "../src/SafetyRegistry.sol";
import {ValidatorRegistry} from "../src/ValidatorRegistry.sol";
import {TriangleMiningState} from "../src/TriangleMiningState.sol";
import {FoundationTreasury} from "../src/FoundationTreasury.sol";
import {ProofRegistry} from "../src/ProofRegistry.sol";
import {CampaignRegistry} from "../src/CampaignRegistry.sol";
import {RewardPool} from "../src/RewardPool.sol";
import {MiningClaimVerifier} from "../src/MiningClaimVerifier.sol";

/// @notice Deploys the full alpha contract system with the protocol-parameter
///         registry's alpha defaults (config/protocol-params.alpha.json) and
///         three protocol validators (weight 50 each, quorum 100 — two of three).
abstract contract StepFixture is Test {
    // Alpha parameter defaults (UNFROZEN — mirror config/protocol-params.alpha.json).
    uint32 internal constant SLOTS = 27;
    uint256 internal constant BASE_REWARD = 67_108_864; // 2^26 → 0-indexed slot 26 (27th slot) = 1
    uint64 internal constant OPENING_DELAY = 0; // pilot config; non-zero tested separately
    uint64 internal constant COOLDOWN = 0; // pilot config; non-zero tested separately
    uint256 internal constant TWIN_BPS = 10_000;
    uint256 internal constant QUORUM = 100;
    uint64 internal constant PARAM_DELAY = 1 days;

    address internal admin = makeAddr("admin");
    address internal miner = makeAddr("miner");
    address internal merchant = makeAddr("merchant");
    address internal seeder = makeAddr("seeder"); // simulates previously-mined Trinity in tests

    uint256[3] internal valKeys;
    address[3] internal valAddrs;

    StepAccess public access;
    TrinityToken public token;
    MeshRegistry public mesh;
    SafetyRegistry public safety;
    ValidatorRegistry public validators;
    TriangleMiningState public state;
    FoundationTreasury public treasury;
    ProofRegistry public proofs;
    CampaignRegistry public campaigns;
    RewardPool public pool;
    MiningClaimVerifier public verifier;

    // Mesh ID v2 dotted form (STEP_mesh_id_v2.md): face 1..20, children 1..4,
    // level = segment count. Mining starts at genesis level 1 (a bare face),
    // which has no parent — so it is mineable without ancestor exhaustion.
    // Deeper levels require their parent Exhausted (tested via the lifecycle).
    string internal constant TRI_A_STRING = "1";
    string internal constant TRI_B_STRING = "8";
    bytes32 internal constant TRI_A = keccak256(bytes(TRI_A_STRING));
    bytes32 internal constant TRI_B = keccak256(bytes(TRI_B_STRING));
    uint8 internal constant LEVEL = 1;

    function setUp() public virtual {
        access = new StepAccess(admin);
        token = new TrinityToken(access);
        uint8[] memory levels = new uint8[](1);
        levels[0] = LEVEL;
        mesh = new MeshRegistry(access, "step-mesh-v1", levels);
        safety = new SafetyRegistry(access);
        validators = new ValidatorRegistry(access);
        state =
            new TriangleMiningState(access, PARAM_DELAY, SLOTS, BASE_REWARD, OPENING_DELAY, COOLDOWN);
        treasury = new FoundationTreasury(access, token, PARAM_DELAY, TWIN_BPS, 0);
        proofs = new ProofRegistry(access);
        campaigns = new CampaignRegistry(access, address(treasury));
        pool = new RewardPool(access, token, campaigns);
        verifier = new MiningClaimVerifier(
            access, PARAM_DELAY, QUORUM, token, mesh, safety, validators, state, treasury, proofs, pool
        );

        vm.startPrank(admin);
        access.grantRole(access.VERIFIER_ROLE(), address(verifier));
        access.grantRole(access.MINTER_ROLE(), address(verifier));
        access.grantRole(access.MINTER_ROLE(), address(treasury));
        access.grantRole(access.MINTER_ROLE(), seeder); // tests only: pre-existing Trinity
        access.grantRole(access.PARAM_ROLE(), admin);
        access.grantRole(access.PAUSER_ROLE(), admin);
        access.grantRole(access.SAFETY_ROLE(), admin);
        access.grantRole(access.TREASURER_ROLE(), admin);
        access.grantRole(access.MERCHANT_ROLE(), merchant);
        access.grantRole(access.CAMPAIGN_MODERATOR_ROLE(), admin);
        access.grantRole(access.VALIDATOR_ADMIN_ROLE(), admin);
        access.grantRole(access.MESH_ADMIN_ROLE(), admin);
        campaigns.setRewardPool(address(pool));

        // Three protocol validators, sorted by address for quorum calls.
        for (uint256 i = 0; i < 3; i++) {
            valKeys[i] = 0xA11CE + i;
            valAddrs[i] = vm.addr(valKeys[i]);
        }
        _sortValidators();
        for (uint256 i = 0; i < 3; i++) {
            validators.registerValidator(
                valAddrs[i], ValidatorRegistry.ValidatorType.Protocol, 50
            );
        }
        vm.stopPrank();
    }

    function _sortValidators() internal {
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (valAddrs[j] < valAddrs[i]) {
                    (valAddrs[i], valAddrs[j]) = (valAddrs[j], valAddrs[i]);
                    (valKeys[i], valKeys[j]) = (valKeys[j], valKeys[i]);
                }
            }
        }
    }

    function _vote(uint256 pk, bytes32 claimHash, string memory tri, address miner_, bool approve)
        internal
        view
        returns (MiningClaimVerifier.ValidatorSig memory)
    {
        bytes32 digest = verifier.voteDigest(claimHash, keccak256(bytes(tri)), miner_, approve);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return MiningClaimVerifier.ValidatorSig({
            validator: vm.addr(pk),
            signature: abi.encodePacked(r, s, v)
        });
    }

    /// @dev Approval votes from validators [0..n), already address-sorted.
    function _quorumSigs(bytes32 claimHash, string memory tri, address miner_, uint256 n)
        internal
        view
        returns (MiningClaimVerifier.ValidatorSig[] memory sigs)
    {
        sigs = new MiningClaimVerifier.ValidatorSig[](n);
        for (uint256 i = 0; i < n; i++) {
            sigs[i] = _vote(valKeys[i], claimHash, tri, miner_, true);
        }
    }

    function _finaliseNatural(bytes32 claimHash, string memory tri, address miner_) internal {
        verifier.finaliseNaturalClaim(
            claimHash, tri, LEVEL, miner_, keccak256("cid"), _quorumSigs(claimHash, tri, miner_, 2)
        );
    }
}
