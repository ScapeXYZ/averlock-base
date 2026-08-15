// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IncomingFundsGuardAccount} from "./IncomingFundsGuardAccount.sol";
import {GuardTypes} from "./libraries/GuardTypes.sol";

/// @title IncomingFundsGuardFactory
/// @notice Deterministically deploys immutable incoming-funds guard accounts.
contract IncomingFundsGuardFactory {
    address public immutable asset;
    address public immutable protectionVault;

    mapping(address owner => address[] guards) private _ownerGuards;
    mapping(address owner => mapping(bytes32 ruleId => address guard)) public guardForRule;

    event IncomingGuardCreated(
        address indexed guard,
        address indexed owner,
        bytes32 indexed ruleId,
        address asset,
        address vault,
        uint256 threshold,
        uint16 protectBps,
        uint64 releaseDuration,
        uint64 createdAt
    );

    error GuardAlreadyExists(address owner, bytes32 ruleId, address guard);
    error UnauthorizedCreator(address caller, address owner);
    error InvalidAsset(address supplied, address expected);
    error InvalidVault(address supplied, address expected);

    constructor(address asset_, address vault_) {
        if (asset_ == address(0) || vault_ == address(0)) revert IncomingFundsGuardAccount.ZeroAddress();
        if (asset_.code.length == 0) revert IncomingFundsGuardAccount.AddressHasNoCode(asset_);
        if (vault_.code.length == 0) revert IncomingFundsGuardAccount.AddressHasNoCode(vault_);
        asset = asset_;
        protectionVault = vault_;
    }

    function createIncomingGuard(GuardTypes.IncomingGuardConfig calldata config) external returns (address guard) {
        _validate(config);
        if (msg.sender != config.owner) revert UnauthorizedCreator(msg.sender, config.owner);
        address existing = guardForRule[config.owner][config.ruleId];
        if (existing != address(0)) revert GuardAlreadyExists(config.owner, config.ruleId, existing);

        bytes32 salt = _salt(config.owner, config.ruleId);
        IncomingFundsGuardAccount account = new IncomingFundsGuardAccount{salt: salt}(
            config.owner,
            config.asset,
            config.vault,
            config.threshold,
            config.protectBps,
            config.releaseDuration,
            config.ruleId
        );
        guard = address(account);

        guardForRule[config.owner][config.ruleId] = guard;
        _ownerGuards[config.owner].push(guard);

        emit IncomingGuardCreated(
            guard,
            config.owner,
            config.ruleId,
            config.asset,
            config.vault,
            config.threshold,
            config.protectBps,
            config.releaseDuration,
            account.createdAt()
        );
    }

    function predictIncomingGuardAddress(GuardTypes.IncomingGuardConfig calldata config)
        external
        view
        returns (address predicted)
    {
        _validate(config);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(IncomingFundsGuardAccount).creationCode,
                abi.encode(
                    config.owner,
                    config.asset,
                    config.vault,
                    config.threshold,
                    config.protectBps,
                    config.releaseDuration,
                    config.ruleId
                )
            )
        );
        predicted = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), _salt(config.owner, config.ruleId), initCodeHash)
                    )
                )
            )
        );
    }

    function guardsOf(address owner) external view returns (address[] memory) {
        return _ownerGuards[owner];
    }

    function guardCountOf(address owner) external view returns (uint256) {
        return _ownerGuards[owner].length;
    }

    function _validate(GuardTypes.IncomingGuardConfig calldata config) private view {
        if (config.owner == address(0) || config.asset == address(0) || config.vault == address(0)) {
            revert IncomingFundsGuardAccount.ZeroAddress();
        }
        if (config.asset != asset) revert InvalidAsset(config.asset, asset);
        if (config.vault != protectionVault) revert InvalidVault(config.vault, protectionVault);
        if (config.threshold == 0) revert IncomingFundsGuardAccount.ZeroThreshold();
        if (config.ruleId == bytes32(0)) revert IncomingFundsGuardAccount.ZeroRuleId();
        if (config.protectBps == 0 || config.protectBps > GuardTypes.BPS_DENOMINATOR) {
            revert IncomingFundsGuardAccount.InvalidProtectBps(config.protectBps);
        }
        if (config.threshold < (GuardTypes.BPS_DENOMINATOR + config.protectBps - 1) / config.protectBps) {
            revert IncomingFundsGuardAccount.ThresholdProducesZeroProtection(config.threshold, config.protectBps);
        }
        if (
            config.releaseDuration < GuardTypes.MIN_RELEASE_DURATION
                || config.releaseDuration > GuardTypes.MAX_RELEASE_DURATION
        ) revert IncomingFundsGuardAccount.InvalidReleaseDuration(config.releaseDuration);
    }

    function _salt(address owner, bytes32 ruleId) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, ruleId));
    }
}
