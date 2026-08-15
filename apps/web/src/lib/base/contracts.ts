import { parseAbi, parseAbiItem } from "viem";
export const baseGuardManagerAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function protectionVault() view returns (address)",
  "function isApprovedAsset(address) view returns (bool)",
  "function createGuard(uint8 guardType,address asset,uint256 amount,uint64 cooldown,uint64 releaseDuration) returns (uint256 guardId)",
  "function fundGuard(uint256 guardId)",
  "function executeGuard(uint256 guardId) returns (uint256 positionId)",
  "function completeGuard(uint256 guardId)",
  "function deactivateGuard(uint256 guardId)",
  "function getGuard(uint256) view returns ((uint256 id,address owner,address asset,uint256 amount,uint256 positionId,uint8 guardType,uint8 state,uint64 cooldown,uint64 releaseDuration,uint64 createdAt,uint64 fundedAt,uint64 eligibleAt,uint64 executedAt))",
  "function currentState(uint256) view returns (uint8)",
]);
export const baseVaultAbi = parseAbi([
  "function getPosition(uint256) view returns ((uint256 id,address asset,address beneficiary,uint256 totalDeposited,uint256 claimed,uint64 startTimestamp,uint64 endTimestamp,uint64 createdAt))",
  "function claimableAmount(uint256) view returns (uint256)",
  "function remainingLockedAmount(uint256) view returns (uint256)",
  "function isFullyVested(uint256) view returns (bool)",
  "function isCompleted(uint256) view returns (bool)",
  "function claim(uint256) returns (uint256 amount)",
]);
export const incomingFundsGuardFactoryAbi = parseAbi([
  "function asset() view returns (address)",
  "function protectionVault() view returns (address)",
  "function guardForRule(address owner,bytes32 ruleId) view returns (address)",
  "function guardsOf(address owner) view returns (address[])",
  "function guardCountOf(address owner) view returns (uint256)",
  "function createIncomingGuard((address owner,address asset,address vault,uint256 threshold,uint16 protectBps,uint64 releaseDuration,bytes32 ruleId) config) returns (address guard)",
  "function predictIncomingGuardAddress((address owner,address asset,address vault,uint256 threshold,uint16 protectBps,uint64 releaseDuration,bytes32 ruleId) config) view returns (address predicted)",
]);
export const incomingFundsGuardAbi = parseAbi([
  "function owner() view returns (address)",
  "function asset() view returns (address)",
  "function protectionVault() view returns (address)",
  "function threshold() view returns (uint256)",
  "function protectBps() view returns (uint16)",
  "function releaseDuration() view returns (uint64)",
  "function ruleId() view returns (bytes32)",
  "function totalProcessed() view returns (uint256)",
  "function processingCount() view returns (uint256)",
  "function process() returns (uint256 positionId)",
]);
export const incomingGuardCreatedEvent = parseAbiItem(
  "event IncomingGuardCreated(address indexed guard,address indexed owner,bytes32 indexed ruleId,address asset,address vault,uint256 threshold,uint16 protectBps,uint64 releaseDuration,uint64 createdAt)",
);
export const incomingFundsProcessedEvent = parseAbiItem(
  "event IncomingFundsProcessed(bytes32 indexed ruleId,address indexed owner,address indexed processor,address asset,uint256 processedAmount,uint256 protectedAmount,uint256 availableAmount,uint256 positionId,uint64 startTimestamp,uint64 endTimestamp)",
);
export const v2ProtectionVaultAbi = baseVaultAbi;
export const baseErc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const guardCreatedEvent = parseAbiItem(
  "event GuardCreated(uint256 indexed guardId,address indexed owner,address indexed asset,uint8 guardType,uint256 amount,uint64 cooldown,uint64 releaseDuration,uint64 createdAt)",
);
