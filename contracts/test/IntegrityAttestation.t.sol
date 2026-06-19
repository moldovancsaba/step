// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StepAccess} from "../src/StepAccess.sol";
import {ValidatorRegistry} from "../src/ValidatorRegistry.sol";
import {IntegrityAttestation} from "../src/IntegrityAttestation.sol";

contract IntegrityAttestationTest is Test {
    StepAccess internal access;
    ValidatorRegistry internal validators;
    IntegrityAttestation internal integrity;

    address internal admin = makeAddr("admin");
    address internal attestor = makeAddr("attestor");
    address internal stranger = makeAddr("stranger");
    address internal node = makeAddr("node");

    bytes32 internal constant MB = keccak256("measured-bin");
    bytes32 internal constant MP = keccak256("measured-params");
    bytes32 internal constant MC = keccak256("measured-config");
    bytes32 internal constant EV = keccak256("evidence");

    function setUp() public {
        access = new StepAccess(admin);
        validators = new ValidatorRegistry(access);
        integrity = new IntegrityAttestation(access, validators);

        bytes32 valAdmin = access.VALIDATOR_ADMIN_ROLE();
        bytes32 integrityRole = access.INTEGRITY_ROLE();
        vm.startPrank(admin);
        access.grantRole(valAdmin, admin); // admin registers + clears
        access.grantRole(valAdmin, address(integrity)); // contract may transition status
        access.grantRole(integrityRole, attestor); // attestor reports
        // register the node (weight 50, Protocol type)
        validators.registerValidator(node, ValidatorRegistry.ValidatorType.Protocol, 50);
        vm.stopPrank();
    }

    function test_ReportDemotesFromQuorum() public {
        assertEq(validators.activeWeight(node), 50);
        vm.expectEmit(true, true, false, true);
        emit IntegrityAttestation.TamperReported(node, attestor, EV);
        vm.prank(attestor);
        integrity.reportTamper(node, MB, MP, MC, EV);

        assertEq(validators.activeWeight(node), 0); // dropped from quorum
        (bool held, IntegrityAttestation.Finding memory f) = integrity.tamperState(node);
        assertTrue(held);
        assertEq(f.measuredBinary, MB);
        assertEq(f.evidenceHash, EV);
        assertEq(f.reporter, attestor);
    }

    function test_ClearRestoresQuorum() public {
        vm.prank(attestor);
        integrity.reportTamper(node, MB, MP, MC, EV);
        assertEq(validators.activeWeight(node), 0);

        vm.prank(admin);
        integrity.clearTamper(node);
        assertEq(validators.activeWeight(node), 50);
        (bool held,) = integrity.tamperState(node);
        assertFalse(held);
    }

    function test_OnlyIntegrityRoleCanReport() public {
        vm.expectRevert();
        vm.prank(stranger);
        integrity.reportTamper(node, MB, MP, MC, EV);
    }

    function test_OnlyValidatorAdminCanClear() public {
        vm.prank(attestor);
        integrity.reportTamper(node, MB, MP, MC, EV);
        vm.expectRevert();
        vm.prank(stranger);
        integrity.clearTamper(node);
    }

    function test_ReportUnregisteredReverts() public {
        address ghost = makeAddr("ghost");
        vm.expectRevert(abi.encodeWithSelector(ValidatorRegistry.NotRegistered.selector, ghost));
        vm.prank(attestor);
        integrity.reportTamper(ghost, MB, MP, MC, EV);
    }

    function test_ClearWhenNotHeldReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IntegrityAttestation.NotUnderHold.selector, node));
        vm.prank(admin);
        integrity.clearTamper(node);
    }
}
