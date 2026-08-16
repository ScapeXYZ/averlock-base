"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  decodeEventLog,
  formatUnits,
  getAddress,
  parseUnits,
} from "viem";
import type { Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { TopNav } from "@/components/dashboard/top-nav";
import {
  baseContracts,
  basePublicClient,
  activeChain,
  activeDeployment,
  deploymentConfigured,
  deploymentEnvironment,
  explorerUrl,
  writesEnabled,
} from "@/lib/base/config";
import {
  baseErc20Abi,
  baseGuardManagerAbi,
  baseVaultAbi,
  guardCreatedEvent,
} from "@/lib/base/contracts";
import {
  discoverActivity,
  guardStates,
  readGuard,
  readWallet,
  saveAnchor,
  summarizeVaultAccounting,
  type BaseGuard,
} from "@/lib/base/data";
import { compactAddress, formatBlockTimestamp } from "@/lib/base/format";
import { groupActivity } from "@/lib/base/activity";
import { AccountingCards } from "@/components/base/accounting/accounting-cards";
import { ProtectionGraph } from "@/components/base/graph/protection-graph";
import { humanizeError } from "@/components/base/status/error-message";
import { canClaim, cooldownState, releaseProgress } from "@/lib/base/ui-state";
import {
  IncomingGuardCreatePage,
  IncomingGuardDetailPage,
} from "@/components/base/incoming-funds-guard";
import {
  isIncomingGuardRoute,
  localIncomingGuards,
} from "@/lib/base/incoming";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="base-shell">
      <TopNav />
      {children}
    </div>
  );
}
function activityAmount(eventName: string, payload: Record<string, string | number | boolean>, decimals: number, symbol: string) {
  const raw = eventName === "IncomingFundsProcessed" ? payload.protectedAmount : payload.amount ?? payload.processedAmount ?? payload.availableAmount;
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  return `${formatUnits(BigInt(raw), decimals)} ${symbol} · `;
}
function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="base-state">
      <span>
        <Icon name="shield" />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Header({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <header className="base-page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  );
}
const duration = (seconds: bigint) =>
  seconds % 86400n === 0n
    ? `${seconds / 86400n} days`
    : `${seconds / 3600n} hours`;

function useWalletData() {
  const { address, chainId, isConnected } = useAccount();
  const [data, setData] = useState<Awaited<ReturnType<typeof readWallet>>>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!address || chainId !== activeChain.id) return;
    setError("");
    setData(undefined);
    try {
      setData(await readWallet(address));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Base contract reads are unavailable.",
      );
    }
  }, [address, chainId]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  return { address, chainId, isConnected, data, error, refresh };
}

export function DashboardPage() {
  const { address, chainId, isConnected, data, error } = useWalletData();
  const { switchChain } = useSwitchChain();
  if (!isConnected)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Connect your wallet"
            body={`Connect a wallet to read your AVERLOCK state directly from ${activeChain.name}.`}
          />
        </main>
      </Shell>
    );
  if (chainId !== activeChain.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title={`${activeChain.name} required`}
            body="AVERLOCK will not read or submit against an unsupported network."
            action={
              <button
                className="primary-button"
                onClick={() => switchChain({ chainId: activeChain.id })}
              >
                Switch network
              </button>
            }
          />
        </main>
      </Shell>
    );
  if (error)
    return (
      <Shell>
        <main className="base-page">
          <State title="Current state unavailable" body={error} />
        </main>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Reading Base contracts"
            body="Checking your known guards and vault positions. No cached value is shown as current state."
          />
        </main>
      </Shell>
    );
  const { protected: protectedTotal, claimable } = summarizeVaultAccounting(data.positions);
  return (
    <Shell>
      <main className="base-page">
        <section className="base-dashboard-hero dashboard-hero-compact">
          <div>
            <span className="base-chip">{activeChain.name}</span>
            <h1>Your protection, clearly accounted for.</h1>
            <p>
              Transparent rules and non-cancelable vaults enforce the plan you
              chose.
            </p>
            <small>{address && compactAddress(address, 12, 10)}</small>
          </div>
          <Link className="primary-button" href="/guards/new">
            Create Protection Guard
          </Link>
        </section>
        {data.warning && <p className="base-warning">{data.warning}</p>}
        <AccountingCards items={[
          { label: "Wallet USDC", value: `${formatUnits(data.usdcBalance, data.decimals)} ${data.symbol}`, definition: "Held in your connected wallet.", primary: true },
          { label: "Committed", value: `${formatUnits(data.committed, data.decimals)} ${data.symbol}`, definition: "Funded manual guards plus unprocessed Incoming Guard balances.", primary: true },
          { label: "Vault Protected", value: `${formatUnits(protectedTotal, data.decimals)} ${data.symbol}`, definition: "Deposited principal that has not been claimed.", primary: true },
          { label: "Claimable", value: `${formatUnits(claimable, data.decimals)} ${data.symbol}`, definition: "Vested principal currently available to claim.", primary: true },
          { label: "ETH Gas Balance", value: `${Number(formatUnits(data.ethBalance, 18)).toFixed(5)} ETH`, definition: "Wallet ETH available for Base gas." },
          { label: "Active Guards", value: data.guards.filter((x) => ![6, 7].includes(x.guard.state)).length.toString(), definition: "Manual rules that have not completed or deactivated." },
          { label: "Vault Positions", value: data.positions.length.toString(), definition: "Discovered V1 and V2 release positions." },
        ]} />
        <ProtectionGraph compact />
        <section className="base-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current state</p>
              <h2>Your protection</h2>
            </div>
            <Link href="/guards">View all guards</Link>
          </div>
          {data.guards.length ? (
            <GuardCards
              items={data.guards.map((x) => x.guard)}
              decimals={data.decimals}
              symbol={data.symbol}
            />
          ) : (
            <State
              title="No protection guards yet"
              body="Create your first guard to commit approved ERC-20 funds to a release plan."
              action={
                <Link className="primary-button" href="/guards/new">
                  Create Guard
                </Link>
              }
            />
          )}
        </section>
      </main>
    </Shell>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

export function GuardsPage() {
  const { address, chainId, isConnected, data, error } = useWalletData();
  const incomingGuards = address ? localIncomingGuards(address) : [];
  if (!isConnected)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Connect your wallet"
            body="Guard discovery is scoped to the connected owner."
          />
        </main>
      </Shell>
    );
  if (chainId !== activeChain.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Unsupported network"
            body={`Switch to ${activeChain.name} to view guards.`}
          />
        </main>
      </Shell>
    );
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Protection Guards"
          title="Your rules"
          body="Discovery comes from AVERLOCK events; every status shown here is re-read from the contract."
        />
        {error ? (
          <State title="Guards unavailable" body={error} />
        ) : !data ? (
          <State
            title="Reading guards"
            body={`Verifying current guard state on ${activeChain.name}.`}
          />
        ) : (
          <>
            {data.warning && <p className="base-warning">{data.warning}</p>}
            {incomingGuards.length > 0 && (
              <div className="base-card-grid incoming-card-list">
                {incomingGuards.map((item) => (
                  <Link href={`/guards/${item.guard}`} className="base-guard-card" key={item.guard}>
                    <span><Icon name="shield" /></span>
                    <div>
                      <small>Incoming Funds Guard</small>
                      <h3>{compactAddress(item.guard, 12, 10)}</h3>
                      <p>Dedicated USDC receipt address</p>
                    </div>
                    <b>View rule</b>
                  </Link>
                ))}
              </div>
            )}
            {data.guards.length ? (
              <GuardCards
                items={data.guards.map((x) => x.guard)}
                decimals={data.decimals}
                symbol={data.symbol}
              />
            ) : !incomingGuards.length ? (
              <State
                title="No guards discovered"
                body="No confirmed guard IDs are available for this wallet."
                action={
                  <Link className="primary-button" href="/guards/new">
                    Create Guard
                  </Link>
                }
              />
            ) : null}
          </>
        )}
      </main>
    </Shell>
  );
}
function GuardCards({
  items,
  decimals,
  symbol,
}: {
  items: BaseGuard[];
  decimals: number;
  symbol: string;
}) {
  return (
    <div className="base-card-grid">
      {items.map((g) => (
        <Link
          href={`/guards/${g.id}`}
          className="base-guard-card"
          key={g.id.toString()}
        >
          <span>
            <Icon name={g.guardType === 0 ? "lock" : "shield"} />
          </span>
          <div>
            <small>
              {g.guardType === 0
                ? "Cooldown protection"
                : "Stablecoin protection"}
            </small>
            <h3>
              {formatUnits(g.amount, decimals)} {symbol}
            </h3>
            <p>
              {duration(g.cooldown)} cooldown · {duration(g.releaseDuration)}{" "}
              release
            </p>
          </div>
          <b>{guardStates[g.state] || "Unknown"}</b>
        </Link>
      ))}
    </div>
  );
}

function ManualGuardDetailPage({ guardId }: { guardId: string }) {
  const { address, chainId } = useAccount();
  const [guard, setGuard] = useState<BaseGuard>();
  const [meta, setMeta] = useState({ symbol: "", decimals: 18 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: activeChain.id });
  const load = useCallback(async () => {
    try {
      const g = await readGuard(BigInt(guardId));
      const [symbol, decimals] = await Promise.all([
        basePublicClient.readContract({
          address: g.asset,
          abi: baseErc20Abi,
          functionName: "symbol",
        }),
        basePublicClient.readContract({
          address: g.asset,
          abi: baseErc20Abi,
          functionName: "decimals",
        }),
      ]);
      setGuard(g);
      setMeta({ symbol, decimals: Number(decimals) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guard unavailable.");
    }
  }, [guardId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000); return () => window.clearInterval(timer); }, []);
  async function act(kind: "fund" | "execute" | "deactivate" | "complete") {
    if (!writesEnabled) {
      setError("Writes are disabled for this deployment environment.");
      return;
    }
    if (!guard || !address || !client) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "fund") {
        if (getAddress(guard.owner) !== getAddress(address))
          throw new Error("Only the guard owner can fund this guard.");
        const allowance = await basePublicClient.readContract({
          address: guard.asset,
          abi: baseErc20Abi,
          functionName: "allowance",
          args: [address, baseContracts.guardManager],
        });
        if (allowance < guard.amount) {
          const approvalSimulation = await client.simulateContract({
            address: guard.asset,
            abi: baseErc20Abi,
            functionName: "approve",
            args: [baseContracts.guardManager, guard.amount],
            account: address,
          });
          const approval = await writeContractAsync(approvalSimulation.request);
          const approvalReceipt = await client.waitForTransactionReceipt({
            hash: approval,
          });
          if (approvalReceipt.status !== "success")
            throw new Error("USDC approval reverted.");
        }
      }
      if (
        kind === "deactivate" &&
        getAddress(guard.owner) !== getAddress(address)
      )
        throw new Error("Only the guard owner can deactivate this guard.");
      const fn =
        kind === "fund"
          ? "fundGuard"
          : kind === "execute"
            ? "executeGuard"
            : kind === "deactivate"
              ? "deactivateGuard"
              : "completeGuard";
      const simulation = await client.simulateContract({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: fn,
        args: [guard.id],
        account: address,
      });
      const hash = await writeContractAsync(simulation.request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The transaction reverted.");
      await load();
    } catch (e) {
      setError(humanizeError(e, "Transaction stopped."));
    } finally {
      setBusy("");
    }
  }
  if (chainId !== activeChain.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title={`${activeChain.name} required`}
            body="Switch networks to inspect this guard."
          />
        </main>
      </Shell>
    );
  const cooldown = guard ? cooldownState(guard.state, guard.eligibleAt, now) : { eligible: false, remaining: 0n };
  const countdown = `${cooldown.remaining / 3600n}h ${(cooldown.remaining % 3600n) / 60n}m ${(cooldown.remaining % 60n)}s`;
  const lifecycle = !guard ? "Loading" : guard.state === 1 ? "Rule Created" : guard.state === 2 && !cooldown.eligible ? "Cooldown Active" : guard.state === 3 || cooldown.eligible ? "Eligible" : guard.state === 5 ? "Protected in Vault" : guard.state === 6 ? "Released" : guardStates[guard.state] || "Unknown";
  return (
    <Shell>
      <main className="base-page">
        {error && <p className="base-error">{error}</p>}
        {!guard ? (
          <State
            title="Reading guard"
            body="Loading authoritative contract state."
          />
        ) : (
          <>
            <Header
              eyebrow={`Guard #${guard.id}`}
              title={
                guard.guardType === 0
                  ? "Cooldown Protection"
                  : "Stablecoin Protection"
              }
              body="This guard's amount and schedule are immutable."
            />
            <section className="base-panel detail-grid">
              <Metric
                label="Current state"
                value={lifecycle}
              />
              <Metric
                label="Protected amount"
                value={`${formatUnits(guard.amount, meta.decimals)} ${meta.symbol}`}
              />
              <Metric label="Cooldown" value={duration(guard.cooldown)} />
              <Metric label="Release" value={duration(guard.releaseDuration)} />
            </section>
            <section className="base-panel action-row">
              <div>
                <h2>Next action</h2>
                <p>
                  {guard.state === 1
                    ? "Approve the exact amount and arm this guard. Once funded, it cannot be deactivated."
                    : guard.state === 2 && !cooldown.eligible
                      ? `Cooldown active. Execution unlocks in ${countdown}.`
                    : guard.state === 3 || cooldown.eligible
                      ? "Cooldown complete. Protection is eligible for permissionless execution."
                    : guard.storedState === 5 && guard.state === 6
                      ? "The vault is fully claimed. Persist completion on the guard."
                      : guard.state === 5
                        ? "Funds are in the non-cancelable vault and release according to schedule."
                        : "No action is currently required."}
                </p>
              </div>
              {guard.state === 1 &&
                address &&
                getAddress(guard.owner) === getAddress(address) && (
                <>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() => act("deactivate")}
                  >
                    Deactivate
                  </button>
                  <button
                    className="primary-button"
                    disabled={!!busy}
                    onClick={() => act("fund")}
                  >
                    {busy ? "Working…" : "Approve & arm"}
                  </button>
                </>
              )}
              {(guard.state === 2 || guard.state === 3) && (
                <button
                  className="primary-button"
                  disabled={!!busy || !cooldown.eligible}
                  onClick={() => act("execute")}
                >
                  {busy ? "Working…" : cooldown.eligible ? "Execute protection" : `Available in ${countdown}`}
                </button>
              )}
              {guard.storedState === 5 && guard.state === 6 && (
                <button
                  className="primary-button"
                  disabled={!!busy}
                  onClick={() => act("complete")}
                >
                  {busy ? "Working…" : "Complete guard"}
                </button>
              )}
              {guard.state === 5 && (
                <Link className="primary-button" href="/vaults">
                  View vault
                </Link>
              )}
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}

export function GuardDetailPage({ guardId }: { guardId: string }) {
  return isIncomingGuardRoute(guardId)
    ? <IncomingGuardDetailPage guardAddress={getAddress(guardId) as Address} />
    : <ManualGuardDetailPage guardId={guardId} />;
}

export function VaultsPage() {
  const { address, chainId, data, error, refresh } = useWalletData();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: activeChain.id });
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [vaultNow, setVaultNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => { const timer = window.setInterval(() => setVaultNow(BigInt(Math.floor(Date.now() / 1000))), 60_000); return () => window.clearInterval(timer); }, []);
  async function claim(id: bigint, vaultAddress: Address) {
    if (!writesEnabled) {
      setActionError("Writes are disabled for this deployment environment.");
      return;
    }
    if (!address || !client) return;
    const positionKey = `${vaultAddress}:${id}`;
    setBusy(positionKey);
    setActionError("");
    try {
      const simulation = await client.simulateContract({
        address: vaultAddress,
        abi: baseVaultAbi,
        functionName: "claim",
        args: [id],
        account: address,
      });
      const hash = await writeContractAsync(simulation.request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Claim reverted.");
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Claim stopped.");
    } finally {
      setBusy("");
    }
  }
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Protection Vaults"
          title="Committed funds"
          body={`Vault balances and claimable amounts are read directly from ${activeChain.name}.`}
        />
        {actionError && <p className="base-error">{actionError}</p>}
        {!address ? (
          <State
            title="Connect your wallet"
            body="Connect the beneficiary wallet."
          />
        ) : chainId !== activeChain.id ? (
          <State
            title={`${activeChain.name} required`}
            body="Vault actions are disabled on other networks."
          />
        ) : error ? (
          <State title="Vaults unavailable" body={error} />
        ) : !data ? (
          <State
            title="Reading vaults"
            body="Checking positions and release state."
          />
        ) : !data.positions.length ? (
          <State
            title="No vault positions"
            body="A position appears here after an armed guard is executed."
          />
        ) : (
          <div className="base-card-grid">
            {data.positions.map((x) => (
              <article
                className="base-vault-card"
                key={`${x.version}:${x.vaultAddress}:${x.position.id}`}
              >
                <div className="vault-content">
                  <div className="vault-title"><div><small>{x.version === "v2" ? "Incoming Funds" : "Manual Guard"}</small><h3>Position #{x.position.id.toString()}</h3></div><span className="status-badge">Releasing</span></div>
                  <dl className="vault-values"><div><dt>Deposited</dt><dd>{formatUnits(x.position.totalDeposited, data.decimals)} {data.symbol}</dd></div><div><dt>Still protected</dt><dd>{formatUnits(x.protectedRemaining, data.decimals)} {data.symbol}</dd></div><div><dt>Claimable</dt><dd>{formatUnits(x.claimable, data.decimals)} {data.symbol}</dd></div></dl>
                  <div className="release-progress"><div><span>Release progress</span><strong>{releaseProgress(x.position.startTimestamp, x.position.endTimestamp, vaultNow).toFixed(0)}%</strong></div><progress max="100" value={releaseProgress(x.position.startTimestamp, x.position.endTimestamp, vaultNow)} /></div>
                  <dl className="vault-metadata"><div><dt>Vested</dt><dd>{formatUnits(x.vested, data.decimals)} {data.symbol}</dd></div><div><dt>Claimed</dt><dd>{formatUnits(x.position.claimed, data.decimals)} {data.symbol}</dd></div><div><dt>Release start</dt><dd>{formatBlockTimestamp(x.position.startTimestamp)}</dd></div><div><dt>Release end</dt><dd>{formatBlockTimestamp(x.position.endTimestamp)}</dd></div></dl>
                  <p className="explorer-links">
                    <a href={`${explorerUrl}/address/${x.vaultAddress}`} target="_blank" rel="noreferrer">Vault contract</a>
                    {x.sourceGuard && <> · <a href={`${explorerUrl}/address/${x.sourceGuard}`} target="_blank" rel="noreferrer">Source Incoming Guard</a></>}
                    {x.transactionHash && <> · <a href={`${explorerUrl}/tx/${x.transactionHash}`} target="_blank" rel="noreferrer">Creation transaction</a></>}
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={!canClaim(x.claimable, writesEnabled) || busy === `${x.vaultAddress}:${x.position.id}`}
                  onClick={() => claim(x.position.id, x.vaultAddress)}
                >
                  {busy === `${x.vaultAddress}:${x.position.id}` ? "Claiming…" : x.claimable > 0n ? "Claim available" : "Nothing claimable"}
                </button>
              </article>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}

export function ActivityPage() {
  const { address, chainId } = useAccount();
  const [items, setItems] = useState<Awaited<ReturnType<typeof discoverActivity>>["items"]>([]);
  const [warning, setWarning] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const groups = groupActivity(items);
  useEffect(() => {
    if (address && chainId === activeChain.id) {
      discoverActivity(address)
        .then((x) => {
          setItems(x.items);
          setWarning(x.warning || "");
          setLoadedFor(address);
        })
        .catch(() => {
          setItems([]);
          setWarning("Activity indexer returned an invalid response. Current contract state remains available.");
          setLoadedFor(address);
        });
    }
  }, [address, chainId]);
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="On-chain activity"
          title="Protection history"
          body="Confirmed AVERLOCK event anchors only. Current state is always read from contracts."
        />
        {warning && <p className="base-warning">{warning}</p>}
        {!address ? (
          <State
            title="Connect your wallet"
            body="Activity is scoped to the connected owner."
          />
        ) : loadedFor.toLowerCase() !== address.toLowerCase() ? (
          <State
            title="Loading activity"
            body="Reading confirmed AVERLOCK events from the optional indexer."
          />
        ) : !groups.length ? (
          <State
            title="No activity discovered"
            body="No confirmed AVERLOCK transactions are available for this wallet."
          />
        ) : (
          <div className="activity-groups">
            {groups.map((group, groupIndex) => (
              <details className="activity-group" key={group.key} open={groupIndex === 0}>
                <summary><span><Icon name="shield" /></span><div><strong>{group.title}</strong><small>{group.guard ? `${compactAddress(group.guard as Address)} · ` : ""}{group.status}{group.timestamp ? ` · ${formatBlockTimestamp(BigInt(group.timestamp))}` : ""}</small></div>
                  {group.kind === "incoming" && <dl><div><dt>Processed</dt><dd>{formatUnits(BigInt(group.processedAmount || 0), 6)} USDC</dd></div><div><dt>Protected</dt><dd>{formatUnits(BigInt(group.protectedAmount || 0), 6)} USDC</dd></div><div><dt>Returned</dt><dd>{formatUnits(BigInt(group.returnedAmount || 0), 6)} USDC</dd></div></dl>}
                </summary>
                <ol>{group.steps.map(({ event, label, completed, amount }, index) => <li key={`${event.transaction_hash}-${event.log_index ?? event.event_name}-${index}`}><b aria-label={completed ? "Completed" : "Pending"}>{completed ? "✓" : "○"}</b><div><strong>{amount === null ? "" : amount ? `${formatUnits(BigInt(amount), 6)} USDC · ` : activityAmount(event.event_name, event.payload, 6, "USDC")}{label}</strong><small>{completed ? "Completed" : "Pending"} · Block {event.block_number}{event.block_timestamp ? ` · ${formatBlockTimestamp(BigInt(event.block_timestamp))}` : ""}</small></div><a href={`${activeChain.blockExplorers.default.url}/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer" aria-label={`${label} transaction`}><Icon name="external" /></a></li>)}</ol>
              </details>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}

export function SettingsPage() {
  const { address, chainId, data } = useWalletData();
  const [version, setVersion] = useState("Unavailable");
  const [rpc, setRpc] = useState("Checking…");
  useEffect(() => {
    Promise.all([
      basePublicClient.getChainId(),
      deploymentConfigured
        ? basePublicClient.readContract({
            address: baseContracts.guardManager,
            abi: baseGuardManagerAbi,
            functionName: "VERSION",
          })
        : Promise.reject(new Error()),
    ])
      .then(([id, v]) => {
        setRpc(id === activeChain.id ? "Available" : "Wrong chain");
        setVersion(String(v));
      })
      .catch(() => setRpc("Unavailable"));
  }, []);
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Settings"
          title="Wallet and network"
          body="Your account context first, with complete contract transparency when you need it."
        />
        <section className="base-panel"><div className="section-heading"><div><p className="eyebrow">Wallet & Network</p><h2>Connected account</h2></div></div><div className="settings-list">
          <Row label="Connected wallet" value={address || "Not connected"} />
          <Row label="ETH balance" value={data ? `${Number(formatUnits(data.ethBalance, 18)).toFixed(5)} ETH` : "—"} />
          <Row label="USDC balance" value={data ? `${formatUnits(data.usdcBalance, data.decimals)} ${data.symbol}` : "—"} />
          <Row label="Selected network" value={chainId ? `${activeChain.name} · ${chainId}` : "Not connected"} />
        </div></section>
        <section className="base-panel"><div className="section-heading"><div><p className="eyebrow">Protection Preferences</p><h2>Interface behavior</h2></div></div><p className="muted-copy">AVERLOCK currently follows your connected wallet and system accessibility preferences. No unsupported preference is simulated or stored.</p></section>
        <details className="base-panel contract-details"><summary><span><small>Advanced / Contracts</small><strong>Deployment transparency</strong></span><span>Expand</span></summary><div className="settings-list">
          <Row label="Environment" value={deploymentEnvironment} />
          <Row label="Product network" value={`${activeChain.name} · ${activeChain.id}`} />
          <Row
            label="RPC / contracts"
            value={deploymentConfigured ? rpc : "Not configured"}
          />
          <Row label="Contract version" value={version} />
          <Row
            label="GuardManager"
            value={activeDeployment.contracts.manual?.guardManager || "Not deployed"}
            link={activeDeployment.contracts.manual?.guardManager && `${activeChain.blockExplorers.default.url}/address/${activeDeployment.contracts.manual.guardManager}`}
          />
          <Row
            label="Legacy Vault"
            value={activeDeployment.contracts.manual?.protectionVault || "Not deployed"}
            link={activeDeployment.contracts.manual?.protectionVault && `${activeChain.blockExplorers.default.url}/address/${activeDeployment.contracts.manual.protectionVault}`}
          />
          <Row
            label="V2 Vault"
            value={activeDeployment.contracts.v2?.protectionVault || "Not deployed"}
            link={activeDeployment.contracts.v2?.protectionVault && `${activeChain.blockExplorers.default.url}/address/${activeDeployment.contracts.v2.protectionVault}`}
          />
          <Row
            label="Incoming Guard Factory"
            value={activeDeployment.contracts.v2?.incomingFundsGuardFactory || "Not deployed"}
            link={activeDeployment.contracts.v2?.incomingFundsGuardFactory && `${activeChain.blockExplorers.default.url}/address/${activeDeployment.contracts.v2.incomingFundsGuardFactory}`}
          />
          <Row
            label="USDC"
            value={baseContracts.approvedToken}
            link={`${activeChain.blockExplorers.default.url}/address/${baseContracts.approvedToken}`}
          />
        </div></details>
      </main>
    </Shell>
  );
}
function Row({
  label,
  value,
  link,
}: {
  label: string;
  value: string | number;
  link?: string;
}) {
  return (
    <div>
      <small>{label}</small>
      {link && deploymentConfigured ? (
        <a href={link} target="_blank" rel="noreferrer">
          {value}
          <Icon name="external" />
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

function ManualCreateGuardPage({ onIncoming }: { onIncoming: () => void }) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const client = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [form, setForm] = useState({
    type: "0",
    amount: "",
    cooldownDays: "7",
    releaseDays: "30",
  });
  const [meta, setMeta] = useState({
    symbol: "USDC",
    decimals: 6,
    balance: 0n,
    approved: false,
    loaded: false,
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (address && deploymentConfigured)
      Promise.all([
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
        basePublicClient.readContract({
          address: baseContracts.approvedToken,
          abi: baseErc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
        basePublicClient.readContract({
          address: baseContracts.guardManager,
          abi: baseGuardManagerAbi,
          functionName: "isApprovedAsset",
          args: [baseContracts.approvedToken],
        }),
      ])
        .then(([symbol, decimals, balance, approved]) =>
          setMeta({
            symbol,
            decimals: Number(decimals),
            balance,
            approved,
            loaded: true,
          }),
        )
        .catch(() =>
          setError(
            `USDC metadata or approved-asset status is unavailable from ${activeChain.name}.`,
          ),
        );
  }, [address]);
  const amount = (() => {
    try {
      return parseUnits(form.amount || "0", meta.decimals);
    } catch {
      return 0n;
    }
  })();
  async function submit() {
    if (!writesEnabled) {
      setError("Writes are disabled for this deployment environment.");
      return;
    }
    if (!address || !client || amount <= 0n) return;
    setError("");
    setStatus("Simulating guard creation…");
    try {
      const args = [
        Number(form.type),
        baseContracts.approvedToken,
        amount,
        BigInt(form.cooldownDays) * 86400n,
        BigInt(form.releaseDays) * 86400n,
      ] as const;
      if (!meta.approved)
        throw new Error("The configured USDC is not approved by GuardManager.");
      const simulation = await client.simulateContract({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: "createGuard",
        args,
        account: address,
      });
      setStatus("Confirm guard creation in your wallet…");
      const hash = await writeContractAsync(simulation.request);
      setStatus(`Waiting for ${activeChain.name} confirmation…`);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Guard creation reverted.");
      let id: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: [guardCreatedEvent],
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === "GuardCreated" &&
            getAddress(decoded.args.owner) === getAddress(address)
          ) {
            id = decoded.args.guardId;
            break;
          }
        } catch {}
      }
      if (id === undefined)
        throw new Error(
          "Confirmed transaction did not contain the expected GuardCreated event.",
        );
      saveAnchor({
        guardId: id.toString(),
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        owner: address,
      });
      setStatus("Guard verified. Opening its current state…");
      router.push(`/guards/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation stopped.");
      setStatus("");
    }
  }
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Create Guard"
          title="Commit to your protection plan"
          body="Choose a transparent rule, fund it after creation, then execute it into a non-cancelable vault when eligible."
        />
        <div className="guard-type-choice" aria-label="Guard type">
          <button className="primary-button" aria-pressed="true">Manual / Cooldown Guard</button>
          <button className="secondary-button" onClick={onIncoming}>Incoming Funds Guard</button>
        </div>
        {!deploymentConfigured ? (
          <State
            title="Deployment not configured"
            body={`${activeChain.name} contract addresses are unavailable. Writes are disabled.`}
          />
        ) : !isConnected ? (
          <State
            title="Connect your wallet"
            body="A connected owner is required to register a guard."
          />
        ) : chainId !== activeChain.id ? (
          <State
            title={`${activeChain.name} required`}
            body="Guard creation is disabled on other networks."
            action={
              <button
                className="primary-button"
                onClick={() => switchChain({ chainId: activeChain.id })}
              >
                Switch network
              </button>
            }
          />
        ) : (
          <section className="create-base-grid">
            <div className="base-panel form-stack">
              <label>
                Approved asset
                <input
                  value={`${meta.symbol} · ${compactAddress(baseContracts.approvedToken)}`}
                  disabled
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="500"
                />
                <small>
                  Wallet balance: {formatUnits(meta.balance, meta.decimals)}{" "}
                  {meta.symbol}
                </small>
              </label>
              <label>
                Cooldown before vault execution
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={form.cooldownDays}
                  onChange={(e) =>
                    setForm({ ...form, cooldownDays: e.target.value })
                  }
                />
                <small>days</small>
              </label>
              <label>
                Linear release duration
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={form.releaseDays}
                  onChange={(e) =>
                    setForm({ ...form, releaseDays: e.target.value })
                  }
                />
                <small>days</small>
              </label>
            </div>
            <aside className="base-panel review-card">
              <p className="eyebrow">Review</p>
              <h2>
                You are protecting {form.amount || "0"} {meta.symbol}.
              </h2>
              <p>
                After you separately approve and arm this guard, the committed
                funds cannot be deactivated. Following a {form.cooldownDays}-day
                cooldown, execution creates an AVERLOCK vault with a{" "}
                {form.releaseDays}-day linear release.
              </p>
              <div className="base-notice">
                <Icon name="lock" />
                <span>
                  Creation does not move tokens. Funding is a separate, explicit
                  transaction with an exact allowance.
                </span>
              </div>
              {error && <p className="base-error">{error}</p>}
              {status && <p className="base-status">{status}</p>}
              <button
                className="primary-button"
                disabled={
                  !!status ||
                  !meta.loaded ||
                  !meta.approved ||
                  meta.decimals !== 6 ||
                  amount <= 0n ||
                  amount > meta.balance
                }
                onClick={submit}
              >
                Create Protection Guard
              </button>
            </aside>
          </section>
        )}
      </main>
    </Shell>
  );
}

export function CreateGuardPage() {
  const [kind, setKind] = useState<"manual" | "incoming">("incoming");
  return kind === "incoming"
    ? <IncomingGuardCreatePage onManual={() => setKind("manual")} />
    : <ManualCreateGuardPage onIncoming={() => setKind("incoming")} />;
}
