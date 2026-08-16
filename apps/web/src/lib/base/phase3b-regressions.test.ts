import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { humanizeError } from "../../components/base/status/error-message";
import { settingsBalancePresentation } from "./wallet-balances";

describe("Phase 3B browser regressions", () => {
  it("turns raw RPC failures into a concise product message", () => {
    const raw = "eth_getLogs is limited to a 10,000 range Request body: { huge: payload }";
    expect(humanizeError(new Error(raw), "Unable to load protection data right now.")).toBe("Base Sepolia RPC is temporarily unavailable.");
  });

  it("presents the real ETH and USDC values passed by the shared balance source", () => {
    expect(settingsBalancePresentation(1_250_000_000_000_000_000n, 42_500_000n)).toEqual({ eth: "1.25000 ETH", usdc: "42.5 USDC" });
  });

  it("wraps long technical content and prevents the product shell from overflowing", () => {
    const css = readFileSync(new URL("../../app/phase3b.css", import.meta.url), "utf8");
    expect(css).toContain(".base-shell{max-width:100%;overflow-x:hidden}");
    expect(css).toContain("white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word");
  });
});
