// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IncomingFundsGuardFactory} from "../../src/base/IncomingFundsGuardFactory.sol";

/// @notice Read-only verification for an already deployed Base Sepolia V2 stack.
contract VerifyBaseSepoliaV2 is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    error WrongChain(uint256 actual);
    error ZeroAddress();
    error MissingCode(address account);
    error UnexpectedAsset(address actual, address expected);
    error UnexpectedVault(address actual, address expected);

    function run() external view {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);

        address vault = vm.envAddress("V2_PROTECTION_VAULT");
        address factoryAddress = vm.envAddress("V2_INCOMING_GUARD_FACTORY");
        if (vault == address(0) || factoryAddress == address(0)) revert ZeroAddress();
        if (BASE_SEPOLIA_USDC.code.length == 0) revert MissingCode(BASE_SEPOLIA_USDC);
        if (vault.code.length == 0) revert MissingCode(vault);
        if (factoryAddress.code.length == 0) revert MissingCode(factoryAddress);

        IncomingFundsGuardFactory factory = IncomingFundsGuardFactory(factoryAddress);
        address configuredAsset = factory.asset();
        address configuredVault = factory.protectionVault();
        if (configuredAsset != BASE_SEPOLIA_USDC) revert UnexpectedAsset(configuredAsset, BASE_SEPOLIA_USDC);
        if (configuredVault != vault) revert UnexpectedVault(configuredVault, vault);

        console2.log("Verified chain ID", block.chainid);
        console2.log("Verified Base Sepolia USDC", configuredAsset);
        console2.log("Verified V2 BaseProtectionVault", configuredVault);
        console2.log("Verified V2 IncomingFundsGuardFactory", factoryAddress);
    }
}
