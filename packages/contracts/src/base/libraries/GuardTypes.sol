// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library GuardTypes {
    uint16 internal constant BPS_DENOMINATOR = 10_000;
    uint64 internal constant MIN_RELEASE_DURATION = 1 hours;
    uint64 internal constant MAX_RELEASE_DURATION = 365 days;

    struct IncomingGuardConfig {
        address owner;
        address asset;
        address vault;
        uint256 threshold;
        uint16 protectBps;
        uint64 releaseDuration;
        bytes32 ruleId;
    }
}
