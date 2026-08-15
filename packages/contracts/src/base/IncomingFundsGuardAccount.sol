// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IBaseProtectionVault} from "./interfaces/IBaseProtectionVault.sol";
import {GuardTypes} from "./libraries/GuardTypes.sol";

/// @title IncomingFundsGuardAccount
/// @notice A dedicated, immutable receipt address that splits accumulated incoming funds.
contract IncomingFundsGuardAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = GuardTypes.BPS_DENOMINATOR;
    uint64 public constant MIN_RELEASE_DURATION = GuardTypes.MIN_RELEASE_DURATION;
    uint64 public constant MAX_RELEASE_DURATION = GuardTypes.MAX_RELEASE_DURATION;

    address public immutable owner;
    IERC20 public immutable asset;
    IBaseProtectionVault public immutable protectionVault;
    uint256 public immutable threshold;
    uint16 public immutable protectBps;
    uint64 public immutable releaseDuration;
    bytes32 public immutable ruleId;
    uint64 public immutable createdAt;

    uint256 public totalProcessed;
    uint256 public processingCount;

    event IncomingFundsProcessed(
        bytes32 indexed ruleId,
        address indexed owner,
        address indexed processor,
        address asset,
        uint256 processedAmount,
        uint256 protectedAmount,
        uint256 availableAmount,
        uint256 positionId,
        uint64 startTimestamp,
        uint64 endTimestamp
    );

    error ZeroAddress();
    error ZeroThreshold();
    error InvalidProtectBps(uint16 protectBps);
    error InvalidReleaseDuration(uint64 releaseDuration);
    error BalanceBelowThreshold(uint256 balance, uint256 threshold);
    error ProtectedAmountIsZero();
    error UnexpectedOwnerReceipt(uint256 expected, uint256 received);

    constructor(
        address owner_,
        address asset_,
        address vault_,
        uint256 threshold_,
        uint16 protectBps_,
        uint64 releaseDuration_,
        bytes32 ruleId_
    ) {
        if (owner_ == address(0) || asset_ == address(0) || vault_ == address(0)) {
            revert ZeroAddress();
        }
        if (threshold_ == 0) revert ZeroThreshold();
        if (protectBps_ == 0 || protectBps_ > BPS_DENOMINATOR) revert InvalidProtectBps(protectBps_);
        if (releaseDuration_ < MIN_RELEASE_DURATION || releaseDuration_ > MAX_RELEASE_DURATION) {
            revert InvalidReleaseDuration(releaseDuration_);
        }

        owner = owner_;
        asset = IERC20(asset_);
        protectionVault = IBaseProtectionVault(vault_);
        threshold = threshold_;
        protectBps = protectBps_;
        releaseDuration = releaseDuration_;
        ruleId = ruleId_;
        createdAt = uint64(block.timestamp);
    }

    /// @notice Processes the entire accumulated asset balance. Anyone may trigger it.
    function process() external nonReentrant returns (uint256 positionId) {
        uint256 processedAmount = asset.balanceOf(address(this));
        if (processedAmount < threshold) revert BalanceBelowThreshold(processedAmount, threshold);

        uint256 protectedAmount = Math.mulDiv(processedAmount, protectBps, BPS_DENOMINATOR);
        if (protectedAmount == 0) revert ProtectedAmountIsZero();
        uint256 availableAmount = processedAmount - protectedAmount;

        // Effects precede interactions; all effects and transfers roll back if any interaction fails.
        totalProcessed += processedAmount;
        ++processingCount;

        if (availableAmount != 0) {
            uint256 ownerBalanceBefore = asset.balanceOf(owner);
            asset.safeTransfer(owner, availableAmount);
            uint256 received = asset.balanceOf(owner) - ownerBalanceBefore;
            if (received != availableAmount) revert UnexpectedOwnerReceipt(availableAmount, received);
        }

        uint64 startTimestamp = uint64(block.timestamp);
        uint64 endTimestamp = startTimestamp + releaseDuration;
        asset.forceApprove(address(protectionVault), protectedAmount);
        positionId =
            protectionVault.createPosition(address(asset), owner, protectedAmount, startTimestamp, endTimestamp);
        asset.forceApprove(address(protectionVault), 0);

        emit IncomingFundsProcessed(
            ruleId,
            owner,
            msg.sender,
            address(asset),
            processedAmount,
            protectedAmount,
            availableAmount,
            positionId,
            startTimestamp,
            endTimestamp
        );
    }
}
