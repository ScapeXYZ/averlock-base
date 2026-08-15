import { getAddress, type Address } from "viem";
import baseMainnetJson from "../../../../../config/deployments/base-mainnet.json";
import baseSepoliaJson from "../../../../../config/deployments/base-sepolia.json";
import { baseMainnet, baseSepolia } from "./chains";

export type DeploymentEnvironment = "staging" | "production";
export type AverlockContracts = Readonly<{ guardManager: Address; protectionVault: Address }>;
export type Deployment = Readonly<{
  environment: DeploymentEnvironment;
  chainId: 84532 | 8453;
  usdc: Address;
  contracts: Partial<AverlockContracts>;
  deploymentBlock: number | null;
  writesEnabled: boolean;
}>;

function deployment(value: typeof baseSepoliaJson | typeof baseMainnetJson): Deployment {
  return {
    ...value,
    environment: value.environment as DeploymentEnvironment,
    chainId: value.chainId as Deployment["chainId"],
    usdc: getAddress(value.usdc),
    contracts: Object.fromEntries(
      Object.entries(value.contracts).map(([key, address]) => [key, getAddress(address)]),
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

export function hasDeployedContracts(value: Deployment = activeDeployment): value is Deployment & { contracts: AverlockContracts } {
  return Boolean(value.contracts.guardManager && value.contracts.protectionVault);
}

export const deploymentAvailable = hasDeployedContracts(activeDeployment);
export const writesEnabled = activeDeployment.writesEnabled && deploymentAvailable;

export function requireDeployedContracts(): AverlockContracts {
  if (!hasDeployedContracts(activeDeployment)) {
    throw new Error(`AVERLOCK deployment is unavailable for ${deploymentEnvironment}.`);
  }
  return activeDeployment.contracts;
}
