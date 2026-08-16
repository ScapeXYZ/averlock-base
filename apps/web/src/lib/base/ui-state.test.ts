import { describe, expect, it } from "vitest";
import { canClaim, canProcess, cooldownState, incomingGuardFieldVisibility, releaseProgress, splitPreview, walletBalancePresentation } from "./ui-state";

describe("protection UI state", () => {
  it("calculates the complementary percentage split", () => {
    expect(splitPreview("70")).toEqual({ protected: 70, available: 30 });
    expect(splitPreview("72.5")).toEqual({ protected: 72.5, available: 27.5 });
  });

  it("rejects invalid percentage previews", () => {
    expect(splitPreview("")).toBeNull();
    expect(splitPreview("101")).toBeNull();
  });

  it("disables processing below threshold and enables it at threshold", () => {
    expect(canProcess(499_999_999n, 500_000_000n, true)).toBe(false);
    expect(canProcess(500_000_000n, 500_000_000n, true)).toBe(true);
  });

  it("keeps processing disabled when deployment writes are disabled", () => {
    expect(canProcess(500_000_000n, 500_000_000n, false)).toBe(false);
  });

  it("reports cooldown remaining and eligibility", () => {
    expect(cooldownState(2, 2_000n, 1_000n)).toEqual({ eligible: false, remaining: 1_000n });
    expect(cooldownState(2, 2_000n, 2_000n)).toEqual({ eligible: true, remaining: 0n });
  });

  it("clamps release progress", () => {
    expect(releaseProgress(100n, 200n, 50n)).toBe(0);
    expect(releaseProgress(100n, 200n, 150n)).toBe(50);
    expect(releaseProgress(100n, 200n, 250n)).toBe(100);
  });

  it("keeps Rule ID out of the normal form", () => {
    expect(incomingGuardFieldVisibility.primary).not.toContain("Rule ID");
    expect(incomingGuardFieldVisibility.advanced).toContain("Rule ID");
  });

  it("presents compact real wallet balance values", () => {
    expect(walletBalancePresentation(2_900_000_000_000_000n, 14_500_000n)).toEqual({ eth: "0.0029 ETH", usdc: "14.5 USDC" });
  });

  it("enables claims only for a positive claimable amount and writable deployment", () => {
    expect(canClaim(0n, true)).toBe(false);
    expect(canClaim(1n, true)).toBe(true);
    expect(canClaim(1n, false)).toBe(false);
  });
});
