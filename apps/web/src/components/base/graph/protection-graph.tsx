"use client";

import { useState } from "react";

type ProtectionGraphNode = { id: string; label: string; detail: string; value?: string };
export const protectionGraphNodes: readonly ProtectionGraphNode[] = [
  { id: "wallet", label: "Wallet", detail: "Your self-custodied wallet remains the owner." },
  { id: "incoming", label: "Incoming Funds", detail: "USDC arrives at a dedicated Guard address." },
  { id: "rule", label: "Rule", detail: "The threshold and split are fixed onchain." },
  { id: "split", label: "Split", detail: "Qualifying funds follow the protection percentage." },
  { id: "available", label: "Available", value: "30%", detail: "Returned directly to the owner wallet." },
  { id: "protected", label: "Protected", value: "70%", detail: "Deposited into a non-cancelable release vault." },
  { id: "vault", label: "Vault", detail: "Principal releases only on the programmed schedule." },
  { id: "release", label: "Release", detail: "Vested USDC becomes claimable onchain." },
] as const;

export function ProtectionGraph({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState("rule");
  const selected = protectionGraphNodes.find((node) => node.id === active)!;
  return (
    <section className={`protection-graph ${compact ? "protection-graph--compact" : ""}`} aria-labelledby={compact ? "map-title" : "graph-title"}>
      <div className="graph-heading">
        <div><p className="eyebrow">{compact ? "Live topology" : "Example protection flow"}</p><h2 id={compact ? "map-title" : "graph-title"}>{compact ? "Protection Map" : "How AVERLOCK routes value"}</h2></div>
        {!compact && <span className="example-badge">Illustrative example</span>}
      </div>
      <div className="graph-canvas">
        <svg className="graph-connectors" viewBox="0 0 760 570" preserveAspectRatio="none" aria-hidden="true">
          <path d="M380 54 L380 86 M380 140 L380 172 M380 226 L380 258 M380 312 C380 336 127 324 127 344 M380 312 C380 336 633 324 633 344 M633 398 L633 430 M633 484 L633 516" />
          {!compact && <><circle className="flow-pulse p1" r="4"/><circle className="flow-pulse p2" r="4"/><circle className="flow-pulse p3" r="4"/></>}
        </svg>
        <div className="graph-grid" aria-label="Protection flow nodes">
          {protectionGraphNodes.map((node) => (
            <button key={node.id} type="button" className={`graph-node graph-node--${node.id} ${active === node.id ? "is-active" : ""}`} onClick={() => setActive(node.id)} aria-pressed={active === node.id}>
              <small>{node.id === "incoming" ? "Dedicated address" : node.id === "rule" ? "Threshold met" : node.id === "split" ? "Programmed routing" : ""}</small>
              <strong>{node.label}</strong>{node.value && !compact && <b>{node.value}</b>}
            </button>
          ))}
        </div>
      </div>
      {!compact && <p className="graph-explanation" aria-live="polite"><strong>{selected.label}.</strong> {selected.detail}</p>}
      <ol className="graph-linear" aria-label="Linear protection flow">
        {protectionGraphNodes.map((node) => <li key={node.id}><strong>{node.label}{node.value ? ` ${node.value}` : ""}</strong><span>{node.detail}</span></li>)}
      </ol>
    </section>
  );
}
