"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  decodeEventLog,
  formatUnits,
  getAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { TopNav } from "@/components/dashboard/top-nav";
import {
  activeChain,
  basePublicClient,
  baseV2Contracts,
  explorerUrl,
  usdcAddress,
  writesEnabled,
} from "@/lib/base/config";
import { hasV2Contracts, activeDeployment } from "@/lib/base/deployments";
import {
  baseErc20Abi,
  incomingFundsGuardAbi,
  incomingFundsGuardFactoryAbi,
  incomingFundsProcessedEvent,
  incomingGuardCreatedEvent,
} from "@/lib/base/contracts";
import {
  availablePercent,
  canProcessIncoming,
  emptyIncomingGuardDraft,
  generateRuleId,
  saveIncomingGuard,
  validProtectPercent,
} from "@/lib/base/incoming";
import { compactAddress } from "@/lib/base/format";

const v2Available = hasV2Contracts(activeDeployment);
const readableError = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "shortMessage" in error)
    return String((error as { shortMessage?: string }).shortMessage || fallback);
  return error instanceof Error ? error.message : fallback;
};
const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="base-shell"><TopNav />{children}</div>
);
const Metric = ({ label, value }: { label: string; value: string }) => (
  <article className="metric-card"><small>{label}</small><strong>{value}</strong></article>
);

type GuardConfig = {
  owner: Address;
  asset: Address;
  vault: Address;
  threshold: bigint;
  protectBps: number;
  releaseDuration: bigint;
  ruleId: Hex;
};

export function IncomingGuardCreatePage({ onManual }: { onManual: () => void }) {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const client = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [form, setForm] = useState(emptyIncomingGuardDraft);
  const [ruleId] = useState(generateRuleId);
  const [predicted, setPredicted] = useState<Address>();
  const [predictionBusy, setPredictionBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const available = availablePercent(form.protectPercent);
  const threshold = (() => {
    try { return parseUnits(form.threshold || "0", 6); } catch { return 0n; }
  })();
  const protectBps = Number(form.protectPercent) * 100;
  const releaseDays = Number(form.releaseDays);
  const valid =
    threshold > 0n &&
    validProtectPercent(form.protectPercent) &&
    Number.isInteger(protectBps) &&
    Number.isFinite(releaseDays) &&
    releaseDays >= 1 / 24 &&
    releaseDays <= 365;

  const config = useMemo<GuardConfig | undefined>(() => {
    if (!address || !valid || !v2Available) return;
    return {
      owner: address,
      asset: usdcAddress,
      vault: baseV2Contracts.protectionVault,
      threshold,
      protectBps,
      releaseDuration: BigInt(Math.round(releaseDays * 86400)),
      ruleId,
    };
  }, [address, valid, threshold, protectBps, releaseDays, ruleId]);

  useEffect(() => {
    let current = true;
    if (!config) return;
    void Promise.resolve().then(async () => {
      if (current) {
        setPredicted(undefined);
        setPredictionBusy(true);
      }
      return basePublicClient.readContract({
        address: baseV2Contracts.incomingFundsGuardFactory,
        abi: incomingFundsGuardFactoryAbi,
        functionName: "predictIncomingGuardAddress",
        args: [config],
      });
    }).then((value) => {
      if (current) setPredicted(value);
    }).catch((reason) => {
      if (current) setError(readableError(reason, "Could not predict the guard address."));
    }).finally(() => {
      if (current) setPredictionBusy(false);
    });
    return () => { current = false; };
  }, [config]);

  async function submit() {
    if (!writesEnabled || !v2Available) {
      setError("Writes are disabled for this deployment environment.");
      return;
    }
    if (!address || !client || !config || !predicted) return;
    setError("");
    setStatus("Simulating rule creation…");
    try {
      const simulation = await client.simulateContract({
        address: baseV2Contracts.incomingFundsGuardFactory,
        abi: incomingFundsGuardFactoryAbi,
        functionName: "createIncomingGuard",
        args: [config],
        account: address,
      });
      setStatus("Confirm rule creation in your wallet…");
      const hash = await writeContractAsync(simulation.request);
      setStatus(`Waiting for ${activeChain.name} confirmation…`);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Rule creation reverted.");
      let created: Address | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: [incomingGuardCreatedEvent],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "IncomingGuardCreated" &&
              getAddress(decoded.args.owner) === getAddress(address) &&
              decoded.args.ruleId === ruleId) {
            created = decoded.args.guard;
            break;
          }
        } catch {}
      }
      if (!created) throw new Error("Confirmed transaction did not emit the expected IncomingGuardCreated event.");
      if (getAddress(created) !== getAddress(predicted))
        throw new Error("Created guard does not match the predicted address.");
      saveIncomingGuard({ guard: created, owner: address, ruleId, transactionHash: hash });
      setStatus("Rule Created. Opening the dedicated Guard…");
      router.push(`/guards/${created}`);
      router.refresh();
    } catch (reason) {
      setError(readableError(reason, "Rule creation stopped."));
      setStatus("");
    }
  }

  return (
    <Shell>
      <main className="base-page">
        <header className="base-page-header">
          <p className="eyebrow">Create Guard</p>
          <h1>Incoming Funds Guard</h1>
          <p>Funds sent to this dedicated Guard address are evaluated against your rule.</p>
        </header>
        <div className="guard-type-choice" aria-label="Guard type">
          <button className="secondary-button" onClick={onManual}>Manual / Cooldown Guard</button>
          <button className="primary-button" aria-pressed="true">Incoming Funds Guard</button>
        </div>
        {!v2Available || !writesEnabled ? (
          <section className="base-state">
            <h2>Deployment unavailable</h2>
            <p>Incoming Funds Guard writes are not deployed for this environment. No Sepolia fallback is used.</p>
          </section>
        ) : !isConnected ? (
          <section className="base-state"><h2>Connect your wallet</h2><p>A connected owner is required to create a rule.</p></section>
        ) : chainId !== activeChain.id ? (
          <section className="base-state">
            <h2>{activeChain.name} required</h2>
            <p>Rule creation is disabled on other networks.</p>
            <button className="primary-button" onClick={() => switchChain({ chainId: activeChain.id })}>Switch network</button>
          </section>
        ) : (
          <section className="create-base-grid">
            <div className="base-panel form-stack">
              <label>Threshold amount in USDC
                <input type="number" min="0" step="any" value={form.threshold}
                  onChange={(event) => setForm({ ...form, threshold: event.target.value })}
                  placeholder="Enter threshold" />
                <small>Example: 500 USDC. No funds move when the rule is created.</small>
              </label>
              <label>Protection percentage
                <input type="number" min="0.01" max="100" step="0.01" value={form.protectPercent}
                  onChange={(event) => setForm({ ...form, protectPercent: event.target.value })}
                  placeholder="Enter percentage" />
                <small>Available to owner: {available === null ? "—" : `${available}%`}</small>
              </label>
              <label>Release duration
                <input type="number" min="1" max="365" value={form.releaseDays}
                  onChange={(event) => setForm({ ...form, releaseDays: event.target.value })} />
                <small>days</small>
              </label>
              <label>Rule ID
                <input value={ruleId} disabled />
                <small>Generated with cryptographically secure browser randomness.</small>
              </label>
            </div>
            <aside className="base-panel review-card">
              <p className="eyebrow">Preview</p>
              <h2>{form.threshold || "—"} USDC threshold</h2>
              <p>
                Protect {form.protectPercent || "—"}% · Available {available === null ? "—" : available}% · Release over {form.releaseDays || "—"} days.
              </p>
              <div className="dedicated-address">
                <small>Future Incoming Guard address</small>
                <strong>{predictionBusy ? "Predicting…" : predicted || "Complete the rule to predict"}</strong>
                {predicted && <a href={`${explorerUrl}/address/${predicted}`} target="_blank" rel="noreferrer">View predicted address <Icon name="external" /></a>}
              </div>
              <div className="base-notice"><Icon name="shield" /><span>
                Funds are not pulled from your normal wallet. Send qualifying USDC to this dedicated address after creation.
              </span></div>
              {error && <p className="base-error">{error}</p>}
              {status && <p className="base-status">{status}</p>}
              <button className="primary-button" disabled={!valid || !predicted || predictionBusy || !!status} onClick={submit}>
                Create Incoming Funds Rule
              </button>
            </aside>
          </section>
        )}
      </main>
    </Shell>
  );
}

type IncomingState = {
  owner: Address;
  asset: Address;
  vault: Address;
  threshold: bigint;
  protectBps: number;
  releaseDuration: bigint;
  ruleId: Hex;
  totalProcessed: bigint;
  processingCount: bigint;
  balance: bigint;
};
type ProcessResult = {
  hash: Hex;
  processedAmount: bigint;
  protectedAmount: bigint;
  availableAmount: bigint;
  positionId: bigint;
};

export function IncomingGuardDetailPage({ guardAddress }: { guardAddress: Address }) {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: activeChain.id });
  const { writeContractAsync } = useWriteContract();
  const [guard, setGuard] = useState<IncomingState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<ProcessResult>();
  const load = useCallback(async () => {
    if (!v2Available) return;
    setError("");
    try {
      const [owner, asset, vault, threshold, protectBps, releaseDuration, ruleId, totalProcessed, processingCount, balance] =
        await Promise.all([
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "owner" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "asset" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "protectionVault" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "threshold" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "protectBps" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "releaseDuration" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "ruleId" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "totalProcessed" }),
          basePublicClient.readContract({ address: guardAddress, abi: incomingFundsGuardAbi, functionName: "processingCount" }),
          basePublicClient.readContract({ address: usdcAddress, abi: baseErc20Abi, functionName: "balanceOf", args: [guardAddress] }),
        ]);
      setGuard({ owner, asset, vault, threshold, protectBps, releaseDuration, ruleId, totalProcessed, processingCount, balance });
    } catch (reason) {
      setError(readableError(reason, "Incoming Guard is unavailable."));
    }
  }, [guardAddress]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function processProtection() {
    if (!writesEnabled) { setError("Writes are disabled for this deployment environment."); return; }
    if (!address || !client || !guard || !canProcessIncoming(guard.balance, guard.threshold)) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const simulation = await client.simulateContract({
        address: guardAddress,
        abi: incomingFundsGuardAbi,
        functionName: "process",
        account: address,
      });
      const hash = await writeContractAsync(simulation.request);
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Protection processing reverted.");
      let processed: Omit<ProcessResult, "hash"> | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: [incomingFundsProcessedEvent], data: log.data, topics: log.topics });
          if (decoded.eventName === "IncomingFundsProcessed" && decoded.args.ruleId === guard.ruleId) {
            processed = {
              processedAmount: decoded.args.processedAmount,
              protectedAmount: decoded.args.protectedAmount,
              availableAmount: decoded.args.availableAmount,
              positionId: decoded.args.positionId,
            };
            break;
          }
        } catch {}
      }
      if (!processed) throw new Error("Confirmed transaction did not emit the expected processing result.");
      setResult({ hash, ...processed });
      await load();
    } catch (reason) {
      setError(readableError(reason, "Protection processing stopped."));
    } finally {
      setBusy(false);
    }
  }

  if (chainId !== activeChain.id) return <Shell><main className="base-page"><section className="base-state"><h2>{activeChain.name} required</h2><p>Switch networks to inspect this Guard.</p></section></main></Shell>;
  const ready = guard ? canProcessIncoming(guard.balance, guard.threshold) : false;
  const status = !guard ? "Loading" : guard.processingCount > 0n && !ready ? "Protected" : ready ? "Ready to Process" : guard.balance > 0n ? "Waiting for Funds" : "Rule Created";
  return (
    <Shell><main className="base-page">
      {error && <p className="base-error">{error}</p>}
      {!v2Available ? <section className="base-state"><h2>Deployment unavailable</h2><p>No Incoming Funds Guard contracts are configured for this environment.</p></section> :
      !guard ? <section className="base-state"><h2>Reading Incoming Guard</h2><p>Loading authoritative contract state.</p></section> : <>
        <header className="base-page-header">
          <p className="eyebrow">Incoming Funds Guard</p>
          <h1>{status}</h1>
          <p>Funds sent to this dedicated Guard address are evaluated against your rule.</p>
        </header>
        <section className="base-panel detail-grid incoming-detail-grid">
          <Metric label="Owner" value={compactAddress(guard.owner, 10, 8)} />
          <Metric label="Guard address" value={compactAddress(guardAddress, 10, 8)} />
          <Metric label="USDC held" value={`${formatUnits(guard.balance, 6)} USDC`} />
          <Metric label="Threshold" value={`${formatUnits(guard.threshold, 6)} USDC`} />
          <Metric label="Protected" value={`${guard.protectBps / 100}%`} />
          <Metric label="Available" value={`${100 - guard.protectBps / 100}%`} />
          <Metric label="Release duration" value={`${Number(guard.releaseDuration) / 86400} days`} />
          <Metric label="Threshold reached" value={ready ? "Yes" : "No"} />
          <Metric label="Process eligibility" value={ready ? "Eligible — permissionless" : "Below threshold"} />
          <Metric label="Times processed" value={guard.processingCount.toString()} />
        </section>
        <section className="base-panel settings-list">
          <div><small>Dedicated Guard</small><a href={`${explorerUrl}/address/${guardAddress}`} target="_blank" rel="noreferrer">{guardAddress}<Icon name="external" /></a></div>
          <div><small>V2 ProtectionVault</small><a href={`${explorerUrl}/address/${guard.vault}`} target="_blank" rel="noreferrer">{guard.vault}<Icon name="external" /></a></div>
        </section>
        <section className="base-panel action-row incoming-actions">
          <div><h2>Dedicated deposit address</h2><p>Send test USDC to the Guard address using your wallet. AVERLOCK does not automatically monitor or pull from your wallet.</p></div>
          <button className="secondary-button" onClick={async () => {
            await navigator.clipboard.writeText(guardAddress);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied" : "Copy Guard Address"}</button>
          <button className="primary-button" disabled={!writesEnabled || !ready || busy || !address} onClick={processProtection}>
            {busy ? "Processing…" : "Process Protection"}
          </button>
        </section>
        {result && <section className="base-panel process-result">
          <p className="eyebrow">Protection processed</p>
          <div className="detail-grid">
            <Metric label="Processed amount" value={`${formatUnits(result.processedAmount, 6)} USDC`} />
            <Metric label="Protected amount" value={`${formatUnits(result.protectedAmount, 6)} USDC`} />
            <Metric label="Returned to owner" value={`${formatUnits(result.availableAmount, 6)} USDC`} />
            <Metric label="Vault position ID" value={result.positionId.toString()} />
          </div>
          <a href={`${explorerUrl}/tx/${result.hash}`} target="_blank" rel="noreferrer">View transaction on Base explorer <Icon name="external" /></a>
          <Link href="/vaults">View vault positions</Link>
        </section>}
      </>}
    </main></Shell>
  );
}
