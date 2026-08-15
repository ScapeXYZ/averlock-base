// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BaseProtectionVault} from "../../src/base/BaseProtectionVault.sol";
import {IncomingFundsGuardFactory} from "../../src/base/IncomingFundsGuardFactory.sol";

/// @notice Deploys an isolated Incoming Funds Guard V2 stack to Base Sepolia.
contract DeployBaseSepoliaV2 is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    error WrongChain(uint256 actual);
    error MissingCode(address account);
    error WiringMismatch();

    function run() external returns (BaseProtectionVault vault, IncomingFundsGuardFactory factory) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        if (BASE_SEPOLIA_USDC.code.length == 0) revert MissingCode(BASE_SEPOLIA_USDC);

        vm.startBroadcast();
        vault = new BaseProtectionVault();
        factory = new IncomingFundsGuardFactory(BASE_SEPOLIA_USDC, address(vault));
        vm.stopBroadcast();

        if (factory.asset() != BASE_SEPOLIA_USDC || factory.protectionVault() != address(vault)) {
            revert WiringMismatch();
        }

        console2.log("V2 BaseProtectionVault", address(vault));
        console2.log("V2 IncomingFundsGuardFactory", address(factory));
        console2.log("Base Sepolia USDC", BASE_SEPOLIA_USDC);
        console2.log("Deployment block", block.number);
    }
}
