import { getAddress, type Address, type Hex } from "viem";
import {
  baseContracts,
  baseV2Contracts,
  basePublicClient,
  deploymentConfigured,
  activeChain,
  activeDeployment,
} from "./config";
import { baseErc20Abi, baseGuardManagerAbi, baseVaultAbi, incomingFundsGuardFactoryAbi, incomingFundsProcessedEvent, positionCreatedEvent } from "./contracts";
import { hasV2Contracts } from "./deployments";
export const guardStates = [
  "Draft",
  "Registered",
  "Funded",
  "Eligible",
  "Executed",
  "Vault active",
  "Completed",
  "Deactivated",
] as const;
export type BaseGuard = {
  id: bigint;
  owner: Address;
  asset: Address;
  amount: bigint;
  positionId: bigint;
  guardType: number;
  state: number;
  storedState: number;
  cooldown: bigint;
  releaseDuration: bigint;
  createdAt: bigint;
  fundedAt: bigint;
  eligibleAt: bigint;
  executedAt: bigint;
};
export type BasePosition = {
  id: bigint;
  asset: Address;
  beneficiary: Address;
  totalDeposited: bigint;
  claimed: bigint;
  startTimestamp: bigint;
  endTimestamp: bigint;
  createdAt: bigint;
};
export type GuardAnchor = {
  guardId: string;
  transactionHash: Hex;
  blockNumber: string;
  owner: Address;
};
export type ActivityAnchor = { transaction_hash: Hex; log_index?: number; block_number: string; block_timestamp?: string; event_name: string; status?: string; contract_address?: string; payload: Record<string, string | number | boolean> };
export type VaultVersion = "manual" | "v2";
export type WalletPosition = {
  version: VaultVersion;
  vaultAddress: Address;
  sourceGuard?: Address;
  transactionHash?: Hex;
  blockNumber?: bigint;
  guard?: BaseGuard;
  position: BasePosition;
  vested: bigint;
  claimable: bigint;
  locked: bigint;
  protectedRemaining: bigint;
};
const key = (owner: Address) => `averlock:base:guards:${owner.toLowerCase()}`;
export function localAnchors(owner: Address): GuardAnchor[] {
  if (typeof window === "undefined") return [];
  try {
    return (
      JSON.parse(localStorage.getItem(key(owner)) || "[]") as GuardAnchor[]
    ).filter((x) => x.owner.toLowerCase() === owner.toLowerCase());
  } catch {
    return [];
  }
}
export function saveAnchor(anchor: GuardAnchor) {
  const rest = localAnchors(anchor.owner).filter(
    (x) => x.guardId !== anchor.guardId,
  );
  localStorage.setItem(key(anchor.owner), JSON.stringify([anchor, ...rest]));
}
export async function discoverGuards(owner: Address) {
  const local = localAnchors(owner);
  const base = process.env.NEXT_PUBLIC_AVERLOCK_INDEXER_URL;
  if (!base)
    return {
      anchors: local,
      warning:
        "Guard discovery is not configured. Showing only guards created in this browser.",
    };
  let response: Response;
  try {
    response = await fetch(
      `${base.replace(/\/$/, "")}/guards?owner=${owner}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return {
      anchors: local,
      warning:
        `Guard discovery indexer is unreachable. Known guard IDs are still verified from ${activeChain.name} contracts.`,
    };
  }
  if (!response.ok)
    return {
      anchors: local,
      warning:
        "Guard discovery is temporarily unavailable. Known guards are still verified from contracts.",
    };
  const body = (await response.json()) as {
    chainId?: number;
    items?: {
      transaction_hash: Hex;
      block_number: string;
      payload: { guardId: string };
    }[];
  };
  if (!isExpectedChain(body.chainId, activeChain.id)) return { anchors: local, warning: "Guard discovery indexer is configured for a different chain." };
  const remote = (body.items || []).map((item) => ({
    guardId: item.payload.guardId,
    transactionHash: item.transaction_hash,
    blockNumber: item.block_number,
    owner,
  }));
  return {
    anchors: [
      ...new Map([...local, ...remote].map((x) => [x.guardId, x])).values(),
    ],
  };
}
export async function discoverActivity(owner: Address) {
  const base = process.env.NEXT_PUBLIC_AVERLOCK_INDEXER_URL;
  const local = await Promise.all(localAnchors(owner).map(async (item) => {
    const block = await basePublicClient.getBlock({ blockNumber: BigInt(item.blockNumber) });
    return { transaction_hash: item.transactionHash, block_number: item.blockNumber, block_timestamp: block.timestamp.toString(), event_name: "GuardCreated", status: "Confirmed", payload: { guardId: item.guardId } } satisfies ActivityAnchor;
  }));
  if (!base) return { items: local, warning: "Activity indexing is not configured. Showing confirmed creation receipts from this browser only." };
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/activity?owner=${owner}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    return { items: local, warning: "Activity indexer is unreachable. Current contract state remains available." };
  }
  if (!response.ok) return { items: local, warning: "Activity indexing is temporarily unavailable." };
  const body = await response.json() as { chainId?: number; items?: ActivityAnchor[]; sync?: { status?: string; lagBlocks?: string } };
  if (!isExpectedChain(body.chainId, activeChain.id)) return { items: local, warning: "Activity indexer is configured for a different chain. Showing locally confirmed activity only." };
  const degraded = body.sync?.status && body.sync.status !== "healthy";
  return {
    items: orderActivity(body.items || []),
    warning: degraded
      ? `Activity indexer is ${body.sync?.status}${body.sync?.lagBlocks ? ` (${body.sync.lagBlocks} blocks behind)` : ""}. Current state is still read from contracts.`
      : undefined,
  };
}

export function orderActivity(items: ActivityAnchor[]) {
  return [...items].sort((a, b) => Number(BigInt(b.block_number) - BigInt(a.block_number)) || (b.log_index || 0) - (a.log_index || 0));
}

export function isExpectedChain(actual: number | undefined, expected: number) {
  return actual === expected;
}

export function summarizeVaultAccounting(positions: WalletPosition[]) {
  return positions.reduce((totals, item) => ({
    protected: totals.protected + item.protectedRemaining,
    claimable: totals.claimable + item.claimable,
  }), { protected: 0n, claimable: 0n });
}

async function readPosition(vaultAddress: Address, positionId: bigint, version: VaultVersion, sourceGuard?: Address, guard?: BaseGuard, transactionHash?: Hex, blockNumber?: bigint): Promise<WalletPosition | undefined> {
  try {
    const [position, vested, claimable, locked] = await Promise.all([
      basePublicClient.readContract({ address: vaultAddress, abi: baseVaultAbi, functionName: "getPosition", args: [positionId] }),
      basePublicClient.readContract({ address: vaultAddress, abi: baseVaultAbi, functionName: "vestedAmount", args: [positionId] }),
      basePublicClient.readContract({ address: vaultAddress, abi: baseVaultAbi, functionName: "claimableAmount", args: [positionId] }),
      basePublicClient.readContract({ address: vaultAddress, abi: baseVaultAbi, functionName: "remainingLockedAmount", args: [positionId] }),
    ]);
    const typed = position as BasePosition;
    return { version, vaultAddress, sourceGuard, guard, transactionHash, blockNumber, position: typed, vested, claimable, locked, protectedRemaining: typed.totalDeposited - typed.claimed };
  } catch {
    return undefined;
  }
}

export function aggregatePositions(...groups: WalletPosition[][]) {
  return [...new Map(groups.flat().map((item) => [`${item.version}:${item.vaultAddress.toLowerCase()}:${item.position.id}`, item])).values()];
}

export async function discoverIncomingGuards(owner: Address): Promise<readonly Address[]> {
  if (!hasV2Contracts(activeDeployment) || activeDeployment.startBlocks.v2 == null) return [];
  return basePublicClient.readContract({
    address: baseV2Contracts.incomingFundsGuardFactory,
    abi: incomingFundsGuardFactoryAbi,
    functionName: "guardsOf",
    args: [owner],
  });
}

export async function discoverV2Positions(owner: Address, knownGuards?: readonly Address[]): Promise<WalletPosition[]> {
  if (!hasV2Contracts(activeDeployment) || activeDeployment.startBlocks.v2 == null) return [];
  const guards = knownGuards || await discoverIncomingGuards(owner);
  const sourceByPosition = new Map<string, Address>();
  await Promise.all(guards.map(async (guard) => {
    const logs = await basePublicClient.getLogs({ address: guard, event: incomingFundsProcessedEvent, args: { owner }, fromBlock: BigInt(activeDeployment.startBlocks.v2!), toBlock: "latest" });
    for (const log of logs) sourceByPosition.set(log.args.positionId!.toString(), guard);
  }));
  const created = await basePublicClient.getLogs({
    address: baseV2Contracts.protectionVault,
    event: positionCreatedEvent,
    args: { beneficiary: owner },
    fromBlock: BigInt(activeDeployment.startBlocks.v2),
    toBlock: "latest",
  });
  const positions = await Promise.all(created.map((log) => readPosition(baseV2Contracts.protectionVault, log.args.positionId!, "v2", sourceByPosition.get(log.args.positionId!.toString()), undefined, log.transactionHash, log.blockNumber)));
  return positions.filter((position): position is WalletPosition => Boolean(position && getAddress(position.position.beneficiary) === getAddress(owner)));
}
export async function readGuard(id: bigint) {
  if (!deploymentConfigured)
    throw new Error(`AVERLOCK contracts are unavailable on ${activeChain.name}.`);
  const [guard, state] = await Promise.all([
    basePublicClient.readContract({
      address: baseContracts.guardManager,
      abi: baseGuardManagerAbi,
      functionName: "getGuard",
      args: [id],
    }),
    basePublicClient.readContract({
      address: baseContracts.guardManager,
      abi: baseGuardManagerAbi,
      functionName: "currentState",
      args: [id],
    }),
  ]);
  return {
    ...(guard as Omit<BaseGuard, "storedState">),
    storedState: Number(guard.state),
    state: Number(state),
  };
}
export async function readWallet(owner: Address) {
  const discovered = await discoverGuards(owner);
  const guards = (
    await Promise.all(
      discovered.anchors.map(async (anchor) => ({
        anchor,
        guard: await readGuard(BigInt(anchor.guardId)),
      })),
    )
  ).filter(({ guard }) => getAddress(guard.owner) === getAddress(owner));
  if (!deploymentConfigured)
    throw new Error(`AVERLOCK contracts are unavailable on ${activeChain.name}.`);
  const [symbol, decimals, ethBalance, usdcBalance] = await Promise.all([
    basePublicClient.readContract({
      address: baseContracts.approvedToken,
      abi: baseErc20Abi,
      functionName: "symbol",
    }),
    basePublicClient.readContract({
      address: baseContracts.approvedToken,
      abi: baseErc20Abi,
      functionName: "decimals",
    }),
    basePublicClient.getBalance({ address: owner }),
    basePublicClient.readContract({
      address: baseContracts.approvedToken,
      abi: baseErc20Abi,
      functionName: "balanceOf",
      args: [owner],
    }),
  ]);
  const manualPositions = (await Promise.all(
    guards
      .filter(({ guard }) => guard.positionId > 0n)
      .map(async ({ guard, anchor }) => {
        return readPosition(baseContracts.protectionVault, guard.positionId, "manual", undefined, guard, anchor.transactionHash, BigInt(anchor.blockNumber));
      }),
  )).filter((position): position is WalletPosition => Boolean(position));
  const incomingGuards = await discoverIncomingGuards(owner);
  const [v2Positions, incomingBalances] = await Promise.all([
    discoverV2Positions(owner, incomingGuards),
    Promise.all(incomingGuards.map((guard) => basePublicClient.readContract({ address: baseContracts.approvedToken, abi: baseErc20Abi, functionName: "balanceOf", args: [guard] }))),
  ]);
  const positions = aggregatePositions(manualPositions, v2Positions);
  const committed = guards.filter(({ guard }) => [2, 3, 4].includes(guard.state)).reduce((sum, { guard }) => sum + guard.amount, 0n) + incomingBalances.reduce((sum, balance) => sum + balance, 0n);
  return {
    guards,
    positions,
    symbol,
    decimals: Number(decimals),
    ethBalance,
    usdcBalance,
    committed,
    warning: discovered.warning,
  };
}
