"use client";

import { useAccount, useBalance, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { activeChain, usdcAddress } from "@/lib/base/config";
import { baseErc20Abi } from "@/lib/base/contracts";
import { compactAddress } from "@/lib/base/format";
import { Icon } from "./icons";
import { walletBalancePresentation } from "@/lib/base/ui-state";

export function WalletControl() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const eth = useBalance({ address, chainId: activeChain.id, query: { enabled: Boolean(address && chainId === activeChain.id) } });
  const usdc = useReadContract({ address: usdcAddress, abi: baseErc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: activeChain.id, query: { enabled: Boolean(address && chainId === activeChain.id) } });
  if (!isConnected) return <button className="wallet-button" aria-label="Connect wallet" onClick={() => connectors[0] && connect({ connector: connectors[0] })}><Icon name="wallet"/> {isPending ? "Connecting…" : "Connect wallet"}</button>;
  if (chainId !== activeChain.id) return <button className="wallet-button wrong" aria-label={`Switch connected wallet to ${activeChain.name}`} onClick={() => switchChain({ chainId: activeChain.id })}>Switch to {activeChain.name}</button>;
  const balances = eth.data && usdc.data !== undefined ? walletBalancePresentation(eth.data.value, usdc.data) : undefined;
  return <div className="wallet-summary">
    <div className="nav-balances" aria-label="Wallet balances"><span>{balances?.eth || "— ETH"}</span><span>{balances?.usdc || "— USDC"}</span></div>
    <button className="wallet-button connected" onClick={() => disconnect()} title="Disconnect wallet" aria-label={`Disconnect wallet ${address}`}><span className="wallet-dot"/>{compactAddress(address)}</button>
  </div>;
}
