import { getAddress, type Address } from "viem";
import baseMainnetJson from "../../../../../config/deployments/base-mainnet.json";
import baseSepoliaJson from "../../../../../config/deployments/base-sepolia.json";
import { baseMainnet, baseSepolia } from "./chains";

export type DeploymentEnvironment = "staging" | "production";
export type ManualGuardContracts = Readonly<{ guardManager: Address; protectionVault: Address }>;
export type V2Contracts = Readonly<{
  protectionVault: Address;
  incomingFundsGuardFactory: Address;
}>;
export type AverlockContracts = Readonly<{
  manual?: ManualGuardContracts;
  v2?: V2Contracts;
}>;
export type Deployment = Readonly<{
  environment: DeploymentEnvironment;
  chainId: 84532 | 8453;
  usdc: Address;
  contracts: Partial<AverlockContracts>;
  startBlocks: Readonly<{ manual: number | null; v2: number | null }>;
  writesEnabled: boolean;
}>;

function deployment(value: typeof baseSepoliaJson | typeof baseMainnetJson): Deployment {
  return {
    ...value,
    environment: value.environment as DeploymentEnvironment,
    chainId: value.chainId as Deployment["chainId"],
    usdc: getAddress(value.usdc),
    contracts: Object.fromEntries(
      Object.entries(value.contracts).map(([version, contracts]) => [
        version,
        Object.fromEntries(
          Object.entries(contracts).map(([name, address]) => [name, getAddress(address)]),
        ),
      ]),
    ),
  };
}

export const deployments = {
  staging: deployment(baseSepoliaJson),
  production: deployment(baseMainnetJson),
} as const satisfies Record<DeploymentEnvironment, Deployment>;

export function resolveDeploymentEnvironment(value = process.env.NEXT_PUBLIC_AVERLOCK_ENV): DeploymentEnvironment {
  if (!value || value === "staging") return "staging";
  if (value === "production") return "production";
  throw new Error(`Invalid NEXT_PUBLIC_AVERLOCK_ENV: ${value}`);
}

export function getDeployment(environment: DeploymentEnvironment): Deployment {
  return deployments[environment];
}

export const deploymentEnvironment = resolveDeploymentEnvironment();
export const activeDeployment = getDeployment(deploymentEnvironment);
export const activeChain = activeDeployment.chainId === baseSepolia.id ? baseSepolia : baseMainnet;
export const usdcAddress = activeDeployment.usdc;
export const explorerUrl = activeChain.blockExplorers.default.url;

export function hasDeployedContracts(
  value: Deployment = activeDeployment,
): value is Deployment & { contracts: AverlockContracts & { manual: ManualGuardContracts } } {
  return Boolean(value.contracts.manual?.guardManager && value.contracts.manual.protectionVault);
}

export function hasV2Contracts(
  value: Deployment = activeDeployment,
): value is Deployment & { contracts: AverlockContracts & { v2: V2Contracts } } {
  return Boolean(value.contracts.v2?.protectionVault && value.contracts.v2.incomingFundsGuardFactory);
}

export const deploymentAvailable = hasDeployedContracts(activeDeployment);
export const writesEnabled = activeDeployment.writesEnabled && deploymentAvailable;

export function requireDeployedContracts(): ManualGuardContracts {
  if (!hasDeployedContracts(activeDeployment)) {
    throw new Error(`AVERLOCK deployment is unavailable for ${deploymentEnvironment}.`);
  }
  return activeDeployment.contracts.manual;
}

export function requireV2Contracts(): V2Contracts {
  if (!hasV2Contracts(activeDeployment)) {
    throw new Error(`AVERLOCK V2 deployment is unavailable for ${deploymentEnvironment}.`);
  }
  return activeDeployment.contracts.v2;
}
