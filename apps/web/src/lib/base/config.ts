import { createPublicClient, http } from "viem";
import { Attribution } from "ox/erc8021";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { activeChain, activeDeployment, deploymentAvailable, deploymentEnvironment, explorerUrl, requireDeployedContracts, usdcAddress, writesEnabled } from "./deployments";

export const AVERLOCK_BUILDER_CODE = "bc_wxycqary";
export const AVERLOCK_DATA_SUFFIX = Attribution.toDataSuffix({ codes: [AVERLOCK_BUILDER_CODE] });
export const activeRpcUrl = (deploymentEnvironment === "staging" ? process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL : process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL) || activeChain.rpcUrls.default.http[0];

export const baseContracts = {
  get guardManager() { return requireDeployedContracts().guardManager; },
  get protectionVault() { return requireDeployedContracts().protectionVault; },
  approvedToken: usdcAddress,
} as const;

export const deploymentConfigured = deploymentAvailable;
export { activeChain, activeDeployment, deploymentEnvironment, explorerUrl, usdcAddress, writesEnabled };
export const basePublicClient = createPublicClient({ chain: activeChain, transport: http(activeRpcUrl) });
export const baseWagmiConfig = createConfig({
  chains: [activeChain], connectors: [injected()],
  transports: {
    84532: http(deploymentEnvironment === "staging" ? activeRpcUrl : "https://sepolia.base.org"),
    8453: http(deploymentEnvironment === "production" ? activeRpcUrl : "https://mainnet.base.org"),
  },
  dataSuffix: AVERLOCK_DATA_SUFFIX, ssr: true,
});
