// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";

contract ReleaseRegistryTest is Test {
    StepAccess internal access;
    ReleaseRegistry internal reg;

    address internal admin = makeAddr("admin");
    address internal publisher = makeAddr("publisher");
    address internal stranger = makeAddr("stranger");
    address internal nodeA = makeAddr("nodeA");

    bytes32 internal constant PLAT = keccak256("darwin-arm64");
    bytes32 internal constant B1 = keccak256("bin-1");
    bytes32 internal constant P1 = keccak256("params-1");
    bytes32 internal constant C1 = keccak256("config-1");
    bytes32 internal constant B2 = keccak256("bin-2");

    function semver(uint64 ma, uint64 mi, uint64 pa) internal pure returns (uint64) {
        return (ma << 32) | (mi << 16) | pa;
    }

    function setUp() public {
        access = new StepAccess(admin);
        reg = new ReleaseRegistry(access);
        bytes32 role = access.RELEASE_ROLE();
        vm.prank(admin);
        access.grantRole(role, publisher);
    }

    function _publish(uint64 v, bytes32 b, bytes32 p, bytes32 c) internal {
        vm.prank(publisher);
        reg.publishRelease(PLAT, v, b, p, c, 0);
    }

    function test_PublishStoresAndPromotes() public {
        uint64 v = semver(1, 0, 0);
        vm.expectEmit(true, true, false, true);
        emit ReleaseRegistry.ReleasePublished(PLAT, v, B1, publisher);
        _publish(v, B1, P1, C1);

        ReleaseRegistry.Release memory r = reg.latestActive(PLAT);
        assertEq(r.version, v);
        assertEq(r.binaryHash, B1);
        assertTrue(reg.isAuthorized(PLAT, B1, P1, C1));
        assertFalse(reg.isAuthorized(PLAT, B2, P1, C1));
    }

    function test_OnlyReleaseRoleCanPublish() public {
        vm.expectRevert();
        vm.prank(stranger);
        reg.publishRelease(PLAT, semver(1, 0, 0), B1, P1, C1, 0);
    }

    function test_VersionMustBeMonotonic() public {
        _publish(semver(1, 2, 0), B1, P1, C1);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReleaseRegistry.NonMonotonicVersion.selector, semver(1, 2, 0), semver(1, 1, 0)
            )
        );
        _publish(semver(1, 1, 0), B2, P1, C1);
    }

    function test_ZeroHashRejected() public {
        vm.expectRevert(ReleaseRegistry.ZeroHash.selector);
        _publish(semver(1, 0, 0), bytes32(0), P1, C1);
    }

    function test_PromoteSwitchesDefault() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        _publish(semver(2, 0, 0), B2, P1, C1);
        assertEq(reg.latestActive(PLAT).version, semver(2, 0, 0));
        vm.prank(publisher);
        reg.promote(PLAT, semver(1, 0, 0));
        assertEq(reg.latestActive(PLAT).version, semver(1, 0, 0));
    }

    function test_NodePinTakesPrecedence() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        _publish(semver(2, 0, 0), B2, P1, C1); // platform default = 2.0.0
        vm.prank(publisher);
        reg.setNodeTarget(nodeA, semver(1, 0, 0)); // canary pin behind default
        assertEq(reg.effectiveTarget(nodeA, PLAT).version, semver(1, 0, 0));
        // a node with no pin follows the platform default
        assertEq(reg.effectiveTarget(stranger, PLAT).version, semver(2, 0, 0));
    }

    function test_RevokeFallsBackToLastGood() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        _publish(semver(2, 0, 0), B2, P1, C1);
        vm.prank(publisher);
        reg.revoke(PLAT, semver(2, 0, 0));
        // default falls back to 1.0.0
        assertEq(reg.latestActive(PLAT).version, semver(1, 0, 0));
        assertEq(reg.effectiveTarget(stranger, PLAT).version, semver(1, 0, 0));
        assertFalse(reg.isAuthorized(PLAT, B2, P1, C1));
        assertTrue(reg.isAuthorized(PLAT, B1, P1, C1));
    }

    function test_RevokePinnedNodeResolvesThrough() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        _publish(semver(2, 0, 0), B2, P1, C1);
        vm.startPrank(publisher);
        reg.setNodeTarget(nodeA, semver(2, 0, 0));
        reg.revoke(PLAT, semver(2, 0, 0));
        vm.stopPrank();
        // pinned-to-revoked → resolves to platform default, which also fell back to 1.0.0
        assertEq(reg.effectiveTarget(nodeA, PLAT).version, semver(1, 0, 0));
    }

    function test_RevokeOnlyVersionLeavesEmptyTarget() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        vm.prank(publisher);
        reg.revoke(PLAT, semver(1, 0, 0));
        assertEq(reg.latestActive(PLAT).version, 0); // agents hold last-good locally
    }

    function test_DoubleRevokeRejected() public {
        _publish(semver(1, 0, 0), B1, P1, C1);
        vm.startPrank(publisher);
        reg.revoke(PLAT, semver(1, 0, 0));
        vm.expectRevert(
            abi.encodeWithSelector(
                ReleaseRegistry.AlreadyRevoked.selector, PLAT, semver(1, 0, 0)
            )
        );
        reg.revoke(PLAT, semver(1, 0, 0));
        vm.stopPrank();
    }

    function test_PromoteUnknownReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(ReleaseRegistry.UnknownRelease.selector, PLAT, semver(9, 0, 0))
        );
        vm.prank(publisher);
        reg.promote(PLAT, semver(9, 0, 0));
    }
}
