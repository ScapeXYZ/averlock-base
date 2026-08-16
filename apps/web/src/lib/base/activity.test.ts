import { describe, expect, it } from "vitest";
import type { ActivityAnchor } from "./data";
import { groupActivity } from "./activity";

const guard = "0x4444444444444444444444444444444444444444";
const tx = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;
const event = (event_name: string, block: number, transaction: string, payload: ActivityAnchor["payload"], contract_address = "0x9999999999999999999999999999999999999999", log_index = 0): ActivityAnchor => ({ event_name, block_number: String(block), block_timestamp: String(1_776_469_700 + block), transaction_hash: transaction as `0x${string}`, contract_address, log_index, status: "Confirmed", payload });

describe("groupActivity", () => {
  it("groups a 5 USDC cycle with 3.5 protected and 1.5 returned into one parent", () => {
    const groups = groupActivity([
      event("IncomingGuardCreated", 1, tx("1"), { guard }),
      event("IncomingFundsReceived", 2, tx("2"), { guard, amount: "5000000" }),
      event("IncomingFundsProcessed", 3, tx("3"), { processedAmount: "5000000", protectedAmount: "3500000", availableAmount: "1500000", positionId: "1" }, guard, 1),
      event("AvailableFundsReturned", 3, tx("3"), { guard, amount: "1500000", positionId: "1" }, guard, 1_000_001),
      event("PositionCreated", 3, tx("3"), { depositor: guard, amount: "3500000", positionId: "1" }, undefined, 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "Incoming Protection #1", processedAmount: "5000000", protectedAmount: "3500000", returnedAmount: "1500000", status: "Completed" });
    expect(groups[0].steps).toHaveLength(6);
    expect(groups[0].steps.map((step) => step.label)).toContain("Vault Position #1 created");
  });

  it("creates Protection #2 later on the same guard without repeating creation", () => {
    const groups = groupActivity([
      event("IncomingGuardCreated", 1, tx("1"), { guard }), event("IncomingFundsReceived", 2, tx("2"), { guard, amount: "5000000" }),
      event("IncomingFundsProcessed", 3, tx("3"), { processedAmount: "5000000", protectedAmount: "3500000", positionId: "1" }, guard),
      event("IncomingFundsReceived", 5, tx("5"), { guard, amount: "2000000" }), event("IncomingFundsProcessed", 6, tx("6"), { processedAmount: "2000000", protectedAmount: "1400000", positionId: "2" }, guard),
    ]);
    expect(groups.map((group) => group.title)).toEqual(["Incoming Protection #2", "Incoming Protection #1"]);
    expect(groups[0].steps.some(({ event: item }) => item.event_name === "IncomingGuardCreated")).toBe(false);
  });

  it("does not group unrelated guards or transactions", () => {
    const other = "0x5555555555555555555555555555555555555555";
    const groups = groupActivity([event("IncomingFundsReceived", 2, tx("2"), { guard: other, amount: "9000000" }), event("IncomingFundsProcessed", 3, tx("3"), { processedAmount: "5000000", protectedAmount: "3500000", positionId: "1" }, guard)]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.kind === "incoming")?.steps.some((step) => step.event.event_name === "IncomingFundsReceived")).toBe(false);
  });

  it("keeps the manual lifecycle grouped with its position and claim", () => {
    const groups = groupActivity([
      event("GuardCreated", 1, tx("1"), { guardId: "7" }), event("GuardFunded", 2, tx("2"), { guardId: "7", amount: "5000000" }),
      event("GuardExecuted", 3, tx("3"), { guardId: "7", positionId: "9", amount: "5000000" }), event("PositionCreated", 3, tx("3"), { positionId: "9", amount: "5000000" }), event("Claimed", 4, tx("4"), { positionId: "9", amount: "1000000" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "manual", title: "Manual Guard #7", status: "Completed" });
    expect(groups[0].steps.map((step) => step.event.event_name)).toEqual(["GuardCreated", "GuardFunded", "GuardExecuted", "PositionCreated", "Claimed"]);
  });
});
