// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IBaseProtectionVault {
    function createPosition(address asset, address beneficiary, uint256 amount, uint64 startTime, uint64 endTime)
        external
        returns (uint256 positionId);
}
