// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";

/// @notice #37 — RELEASE_ROLE held by an OZ TimelockController so authorizing new
///         code requires a delay window (and, in production, an M-of-N Safe as the
///         proposer). This proves direct publishing is impossible and that the
///         schedule → delay → execute / cancel flow works. The multisig threshold
///         is enforced by the proposer (Safe), not custom code — per the issue's
///         "use audited OZ/Safe, no custom multisig".
contract ReleaseGovernanceTest is Test {
    StepAccess internal access;
    ReleaseRegistry internal reg;
    TimelockController internal timelock;

    address internal admin = makeAddr("admin");
    address internal proposer = makeAddr("proposer"); // a Safe (M-of-N) in production
    address internal executor = makeAddr("executor");

    bytes32 internal constant PLAT = keccak256("darwin-arm64");
    bytes32 internal constant B1 = keccak256("bin-1");
    bytes32 internal constant P1 = keccak256("params-1");
    bytes32 internal constant C1 = keccak256("config-1");
    bytes32 internal constant PKG1 = keccak256("package-1");
    bytes32 internal constant MAN1 = keccak256("manifest-1");
    bytes32 internal constant CHUNK1 = keccak256("chunks-1");
    uint256 internal constant DELAY = 2 days;

    function setUp() public {
        access = new StepAccess(admin);
        reg = new ReleaseRegistry(access);

        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = executor;
        timelock = new TimelockController(DELAY, proposers, executors, address(0));

        // RELEASE_ROLE is held ONLY by the timelock — no bare key can publish.
        bytes32 role = access.RELEASE_ROLE();
        vm.prank(admin);
        access.grantRole(role, address(timelock));
    }

    function _publishCalldata(uint64 v) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(
            ReleaseRegistry.publishRelease.selector, PLAT, v, B1, P1, C1, PKG1, MAN1, CHUNK1, uint64(1234), uint64(0)
        );
    }

    function test_DirectPublishReverts() public {
        vm.expectRevert();
        vm.prank(proposer);
        reg.publishRelease(PLAT, 1, B1, P1, C1, PKG1, MAN1, CHUNK1, 1234, 0);
    }

    function test_ScheduleDelayExecutePublishes() public {
        bytes memory data = _publishCalldata(1 << 32); // 1.0.0
        bytes32 salt = keccak256("rel-1");

        vm.prank(proposer);
        timelock.schedule(address(reg), 0, data, bytes32(0), salt, DELAY);

        // executing before the delay must fail
        vm.expectRevert();
        vm.prank(executor);
        timelock.execute(address(reg), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + DELAY + 1);
        vm.prank(executor);
        timelock.execute(address(reg), 0, data, bytes32(0), salt);

        assertEq(reg.latestActive(PLAT).version, 1 << 32);
        assertTrue(reg.isAuthorized(PLAT, B1, P1, C1));
    }

    function test_CancelAbortsBadRelease() public {
        bytes memory data = _publishCalldata(1 << 32);
        bytes32 salt = keccak256("rel-cancel");
        vm.prank(proposer);
        timelock.schedule(address(reg), 0, data, bytes32(0), salt, DELAY);

        bytes32 id = timelock.hashOperation(address(reg), 0, data, bytes32(0), salt);
        // proposer holds the canceller role in this OZ version's default wiring
        vm.prank(proposer);
        timelock.cancel(id);

        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert();
        vm.prank(executor);
        timelock.execute(address(reg), 0, data, bytes32(0), salt);
        assertEq(reg.latestActive(PLAT).version, 0); // never published
    }
}
