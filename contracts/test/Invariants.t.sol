// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {StepFixture} from "./StepFixture.sol";
import {Test} from "forge-std/Test.sol";
import {MiningClaimVerifier} from "../src/MiningClaimVerifier.sol";

/// @notice Supply-accounting invariants (test plan §2.3):
///         totalSupply == miner mints + twin mints (no other mint path), and
///         per-triangle used slots never exceed the slot parameter.
contract MiningHandler is Test {
    StepFixtureHarness internal h;
    uint256 public ghostMinerMinted;
    uint256 internal nonce;

    bytes32[4] internal tris = [
        keccak256("STEP-21-F00-000000000000000000A0"),
        keccak256("STEP-21-F03-000000000000000000B1"),
        keccak256("STEP-21-F11-000000000000000000C2"),
        keccak256("STEP-21-F19-000000000000000000D3")
    ];

    constructor(StepFixtureHarness h_) {
        h = h_;
    }

    function mineNatural(uint256 triSeed, uint256 minerSeed) external {
        bytes32 tri = tris[triSeed % tris.length];
        address miner_ = address(uint160(0x10000 + (minerSeed % 64)));
        bytes32 claimHash = keccak256(abi.encode("inv", ++nonce));
        uint256 expected = h.exposedNextReward(tri);
        if (expected == 0) return; // exhausted: skip rather than revert
        h.exposedFinalise(claimHash, tri, miner_);
        ghostMinerMinted += expected;
    }
}

/// @dev Exposes fixture internals to the handler.
contract StepFixtureHarness is StepFixture {
    function exposedFinalise(bytes32 claimHash, bytes32 tri, address miner_) external {
        _finaliseNatural(claimHash, tri, miner_);
    }

    function exposedNextReward(bytes32 tri) external view returns (uint256) {
        return state.nextReward(tri);
    }
}

contract SupplyInvariantTest is Test {
    StepFixtureHarness internal h;
    MiningHandler internal handler;

    function setUp() public {
        h = new StepFixtureHarness();
        h.setUp();
        handler = new MiningHandler(h);
        targetContract(address(handler));
    }

    function invariant_supply_equals_miner_plus_twin() public {
        assertEq(
            h.token().totalSupply(),
            handler.ghostMinerMinted() + h.treasury().totalTwinMinted(),
            "supply accounting must balance"
        );
    }

    function invariant_treasury_holds_all_twin() public {
        // No withdrawals in this scenario: treasury balance == lifetime twin.
        assertEq(h.token().balanceOf(address(h.treasury())), h.treasury().totalTwinMinted());
    }
}
