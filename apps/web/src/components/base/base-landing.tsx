import Link from "next/link";
import { Icon } from "@/components/dashboard/icons";
import { ProtectionGraph } from "@/components/base/graph/protection-graph";
import { activeChain, deploymentEnvironment, writesEnabled } from "@/lib/base/config";

export function BaseLanding() {
  return <main className="base-landing">
    <nav><Link className="wordmark" href="/" aria-label="AVERLOCK home"><span className="logo-mark"><Icon name="shield" /></span><span>AVERLOCK</span></Link><span className="base-chip">Built on Base · {activeChain.name}</span></nav>
    <section className="landing-hero">
      <div className="landing-copy"><p className="landing-kicker">Programmable protection on Base</p><h1>Protect incoming funds before discipline becomes a decision.</h1><p>Route qualifying USDC through a dedicated Incoming Guard, keep a chosen share available, and release protected principal on a schedule you cannot cancel.</p><div className="landing-actions"><Link className="primary-button" href="/guards/new">Create a protection rule <Icon name="arrow" /></Link><Link className="entry-secondary" href="/dashboard">Open dashboard</Link></div><ul className="trust-list"><li>Non-custodial</li><li>Transparent onchain execution</li><li>Non-cancelable release vaults</li></ul></div>
      <ProtectionGraph />
    </section>
    <section id="how" className="landing-steps">
      {[["shield", "Dedicated Incoming Guard", "Receive USDC at a deterministic address owned by your rule."], ["pulse", "Programmable split", "Process funds only after the onchain threshold is reached."], ["lock", "Protection Vault", "Protected principal enters a non-cancelable linear release."], ["wallet", "Verifiable release", "Claim only the amount the vault reports as vested."]].map((item, index) => <article key={item[1]}><b>0{index + 1}</b><Icon name={item[0]} /><h2>{item[1]}</h2><p>{item[2]}</p></article>)}
    </section>
    <section className="protocol-statement"><div><p className="eyebrow">Designed for credible commitment</p><h2>Your plan becomes infrastructure.</h2></div><p>AVERLOCK never invents account state. Wallet balances come from live reads, transactions require explicit wallet confirmation, and every protection outcome is traceable on Base.</p></section>
    <footer><span>AVERLOCK</span><p>{deploymentEnvironment === "production" && !writesEnabled ? "Base Mainnet contracts are not live. Mainnet execution remains disabled." : `Staging on ${activeChain.name}.`}</p></footer>
  </main>;
}
