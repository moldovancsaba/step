// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title StepAccess — central role registry and emergency pause (SC-002 AccessController)
/// @notice Single source of truth for roles across all STEP contracts, plus
///         domain-scoped emergency pause switches (HARD §11.4 emergency powers).
///         All emergency actions emit events for public review.
contract StepAccess is AccessControl {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant PARAM_ROLE = keccak256("PARAM_ROLE");
    bytes32 public constant VALIDATOR_ADMIN_ROLE = keccak256("VALIDATOR_ADMIN_ROLE");
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
    bytes32 public constant SAFETY_ROLE = keccak256("SAFETY_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    bytes32 public constant MERCHANT_ROLE = keccak256("MERCHANT_ROLE");
    bytes32 public constant CAMPAIGN_MODERATOR_ROLE = keccak256("CAMPAIGN_MODERATOR_ROLE");
    bytes32 public constant MESH_ADMIN_ROLE = keccak256("MESH_ADMIN_ROLE");
    /// @dev Held only by contract addresses (MiningClaimVerifier, FoundationTreasury).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    /// @dev Held only by the MiningClaimVerifier contract address.
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    /// @dev Held only by the MiningClaimVerifier; authorises minting slot NFTs (#4/#5).
    bytes32 public constant NFT_MINTER_ROLE = keccak256("NFT_MINTER_ROLE");

    bytes32 public constant PAUSE_MINTING = keccak256("PAUSE_MINTING");
    bytes32 public constant PAUSE_CAMPAIGNS = keccak256("PAUSE_CAMPAIGNS");
    /// @dev Emergency stop for the triangle NFT marketplace (#8).
    bytes32 public constant PAUSE_MARKET = keccak256("PAUSE_MARKET");

    mapping(bytes32 => bool) private _paused;

    event DomainPaused(bytes32 indexed domain, address indexed by);
    event DomainUnpaused(bytes32 indexed domain, address indexed by);

    error DomainIsPaused(bytes32 domain);
    error MissingRole(bytes32 role, address account);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setPaused(bytes32 domain, bool paused_) external onlyRole(PAUSER_ROLE) {
        _paused[domain] = paused_;
        if (paused_) emit DomainPaused(domain, msg.sender);
        else emit DomainUnpaused(domain, msg.sender);
    }

    function isPaused(bytes32 domain) public view returns (bool) {
        return _paused[domain];
    }

    /// @notice Revert helper for satellite contracts.
    function checkRole(bytes32 role, address account) external view {
        if (!hasRole(role, account)) revert MissingRole(role, account);
    }

    function checkNotPaused(bytes32 domain) external view {
        if (_paused[domain]) revert DomainIsPaused(domain);
    }
}

/// @title StepManaged — base for contracts governed by StepAccess
abstract contract StepManaged {
    StepAccess public immutable ACCESS;

    constructor(StepAccess access_) {
        require(address(access_) != address(0), "StepManaged: zero access");
        ACCESS = access_;
    }

    modifier onlyStepRole(bytes32 role) {
        ACCESS.checkRole(role, msg.sender);
        _;
    }

    modifier whenDomainNotPaused(bytes32 domain) {
        ACCESS.checkNotPaused(domain);
        _;
    }
}
