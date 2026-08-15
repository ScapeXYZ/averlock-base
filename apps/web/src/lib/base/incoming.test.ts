import { describe, expect, it } from "vitest";
import {
  availablePercent,
  canProcessIncoming,
  emptyIncomingGuardDraft,
  guardTypeOptions,
  isIncomingGuardRoute,
  validProtectPercent,
} from "./incoming";

describe("Incoming Funds Guard frontend rules", () => {
  it("previews 500 USDC at 70% protected as 30% available", () => {
    expect(availablePercent("70")).toBe(30);
  });

  it("starts with an empty threshold and protection percentage", () => {
    expect(emptyIncomingGuardDraft()).toEqual({
      threshold: "",
      protectPercent: "",
      releaseDays: "30",
    });
  });

  it("enforces protection percentage bounds", () => {
    expect(validProtectPercent("0")).toBe(false);
    expect(validProtectPercent("0.01")).toBe(true);
    expect(validProtectPercent("100")).toBe(true);
    expect(validProtectPercent("100.01")).toBe(false);
    expect(validProtectPercent("")).toBe(false);
  });

  it("recognizes the deterministic address detail path", () => {
    expect(isIncomingGuardRoute("0x1111111111111111111111111111111111111111")).toBe(true);
    expect(isIncomingGuardRoute("42")).toBe(false);
  });

  it("keeps the manual Guard flow available", () => {
    expect(guardTypeOptions).toContain("Manual / Cooldown Guard");
    expect(guardTypeOptions).toContain("Incoming Funds Guard");
  });

  it("disables processing below threshold and enables it at threshold", () => {
    expect(canProcessIncoming(499_999_999n, 500_000_000n)).toBe(false);
    expect(canProcessIncoming(500_000_000n, 500_000_000n)).toBe(true);
  });
});
