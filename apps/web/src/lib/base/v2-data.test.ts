import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { aggregatePositions, isExpectedChain, orderActivity, summarizeVaultAccounting, type WalletPosition } from "./data";
import { formatBlockTimestamp } from "./format";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const manualVault = "0x2222222222222222222222222222222222222222" as Address;
const v2Vault = "0x3333333333333333333333333333333333333333" as Address;
const sourceGuard = "0x4444444444444444444444444444444444444444" as Address;

function position(version: "manual" | "v2", id: bigint, deposited: bigint, claimed: bigint, claimable: bigint): WalletPosition {
  return {
    version,
    vaultAddress: version === "v2" ? v2Vault : manualVault,
    sourceGuard: version === "v2" ? sourceGuard : undefined,
    position: { id, asset: owner, beneficiary: owner, totalDeposited: deposited, claimed, startTimestamp: 1n, endTimestamp: 2n, createdAt: 1n },
    vested: claimed + claimable,
    claimable,
    locked: deposited - claimed - claimable,
    protectedRemaining: deposited - claimed,
  };
}

describe("V2 vault data", () => {
  it("represents position #1 with its V2 vault and Incoming Guard source", () => {
    const item = position("v2", 1n, 3_500_000n, 0n, 1_000_000n);
    expect(item.position.id).toBe(1n);
    expect(item.vaultAddress).toBe(v2Vault);
    expect(item.sourceGuard).toBe(sourceGuard);
  });

  it("aggregates legacy and V2 without mixing contract identities", () => {
    const items = aggregatePositions([position("manual", 1n, 2n, 0n, 0n)], [position("v2", 1n, 3n, 0n, 0n)]);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.vaultAddress))).toEqual(new Set([manualVault, v2Vault]));
  });

  it("excludes claimed principal from protected while retaining claimable", () => {
    expect(summarizeVaultAccounting([position("v2", 1n, 3_500_000n, 500_000n, 750_000n)])).toEqual({ protected: 3_000_000n, claimable: 750_000n });
  });

  it("orders activity newest first", () => {
    const items = orderActivity([
      { transaction_hash: "0x01", block_number: "10", log_index: 1, event_name: "A", payload: {} },
      { transaction_hash: "0x02", block_number: "11", log_index: 0, event_name: "B", payload: {} },
      { transaction_hash: "0x03", block_number: "10", log_index: 2, event_name: "C", payload: {} },
    ]);
    expect(items.map((item) => item.event_name)).toEqual(["B", "C", "A"]);
  });

  it("rejects cross-chain indexer responses", () => {
    expect(isExpectedChain(84532, 84532)).toBe(true);
    expect(isExpectedChain(8453, 84532)).toBe(false);
  });
});

it("formats a confirmed timestamp professionally", () => {
  expect(formatBlockTimestamp(1_776_469_740n, "en-US")).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2026 · \d{1,2}:\d{2} [AP]M$/);
});
