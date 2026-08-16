"use client";

import { useAccount, useBalance, useReadContract } from "wagmi";
import { activeChain, usdcAddress } from "./config";
import { baseErc20Abi } from "./contracts";
import { formatUnits } from "viem";

export function settingsBalancePresentation(eth?: bigint, usdc?: bigint) {
  return {
    eth: eth === undefined ? "—" : `${Number(formatUnits(eth, 18)).toFixed(5)} ETH`,
    usdc: usdc === undefined ? "—" : `${formatUnits(usdc, 6)} USDC`,
  };
}

export function useWalletBalances() {
  const { address, chainId } = useAccount();
  const enabled = Boolean(address && chainId === activeChain.id);
  const eth = useBalance({ address, chainId: activeChain.id, query: { enabled } });
  const usdc = useReadContract({ address: usdcAddress, abi: baseErc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: activeChain.id, query: { enabled } });
  return { eth: eth.data?.value, usdc: usdc.data };
}
