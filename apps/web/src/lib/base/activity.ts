import type { ActivityAnchor } from "./data";

export type ActivityStep = {
  event: ActivityAnchor;
  label: string;
  completed: boolean;
  amount?: string | null;
};

export type ActivityGroup = {
  key: string;
  kind: "incoming" | "manual" | "event";
  title: string;
  guard?: string;
  processedAmount?: string;
  protectedAmount?: string;
  returnedAmount?: string;
  status: "Completed" | "Pending" | "Confirmed";
  timestamp?: string;
  blockNumber: string;
  logIndex: number;
  steps: ActivityStep[];
};

const value = (event: ActivityAnchor, key: string) => {
  const item = event.payload[key];
  return typeof item === "string" || typeof item === "number" ? String(item) : undefined;
};
const lower = (item?: string) => item?.toLowerCase();
const guardFor = (event: ActivityAnchor) => lower(value(event, "guard") || (event.event_name === "IncomingFundsProcessed" ? event.contract_address : undefined));
const positionFor = (event: ActivityAnchor) => value(event, "positionId");
const newestFirst = (a: ActivityAnchor, b: ActivityAnchor) => Number(BigInt(b.block_number) - BigInt(a.block_number)) || (b.log_index || 0) - (a.log_index || 0);
const oldestFirst = (a: ActivityAnchor, b: ActivityAnchor) => -newestFirst(a, b);

const labels: Record<string, string> = {
  IncomingGuardCreated: "Incoming Guard created",
  IncomingFundsReceived: "USDC received",
  IncomingFundsProcessed: "Protection processed",
  AvailableFundsReturned: "USDC returned to owner",
  PositionCreated: "Vault position created",
  GuardCreated: "Rule created",
  GuardFunded: "Funded",
  GuardEligible: "Eligible",
  GuardExecuted: "Executed",
  Claimed: "Claim",
};

export function activityStepLabel(event: ActivityAnchor) {
  if (event.event_name === "PositionCreated" && positionFor(event)) return `Vault Position #${positionFor(event)} created`;
  return labels[event.event_name] || event.event_name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function groupFrom(events: ActivityAnchor[], group: Omit<ActivityGroup, "blockNumber" | "logIndex" | "steps">): ActivityGroup {
  const ordered = [...events].sort(oldestFirst);
  const latest = [...events].sort(newestFirst)[0];
  return {
    ...group,
    blockNumber: latest.block_number,
    logIndex: latest.log_index || 0,
    steps: ordered.flatMap((event) => event.event_name === "IncomingFundsProcessed"
      ? [
          { event, label: activityStepLabel(event), completed: event.status !== "Pending", amount: null },
          { event, label: "USDC protected", completed: event.status !== "Pending", amount: value(event, "protectedAmount") },
        ]
      : [{ event, label: activityStepLabel(event), completed: event.status !== "Pending" }]),
  };
}

export function groupActivity(raw: ActivityAnchor[]): ActivityGroup[] {
  const items = [...raw].sort(oldestFirst);
  const used = new Set<ActivityAnchor>();
  const groups: ActivityGroup[] = [];
  const creations = new Map<string, ActivityAnchor>();
  const deposits = new Map<string, ActivityAnchor[]>();

  for (const event of items) {
    const guard = guardFor(event);
    if (event.event_name === "IncomingGuardCreated" && guard) creations.set(guard, event);
    if (event.event_name === "IncomingFundsReceived" && guard) {
      const list = deposits.get(guard) || [];
      list.push(event);
      deposits.set(guard, list);
    }
  }

  const cycleNumber = new Map<string, number>();
  for (const processed of items.filter((event) => event.event_name === "IncomingFundsProcessed")) {
    const guard = guardFor(processed);
    if (!guard) continue;
    const position = positionFor(processed);
    const number = (cycleNumber.get(guard) || 0) + 1;
    cycleNumber.set(guard, number);
    const events: ActivityAnchor[] = [];
    if (number === 1 && creations.has(guard)) events.push(creations.get(guard)!);
    for (const deposit of deposits.get(guard) || []) {
      if (!used.has(deposit) && BigInt(deposit.block_number) <= BigInt(processed.block_number)) events.push(deposit);
    }
    events.push(processed);
    for (const candidate of items) {
      const sameTransaction = candidate.transaction_hash.toLowerCase() === processed.transaction_hash.toLowerCase();
      const samePosition = position && positionFor(candidate) === position;
      const belongsToGuard = guardFor(candidate) === guard;
      if ((sameTransaction || samePosition) && (belongsToGuard || ["PositionCreated", "AvailableFundsReturned"].includes(candidate.event_name))) events.push(candidate);
    }
    const unique = [...new Set(events)];
    unique.forEach((event) => used.add(event));
    const hasPosition = unique.some((event) => event.event_name === "PositionCreated") || !position || position === "0";
    groups.push(groupFrom(unique, {
      key: `incoming:${guard}:${processed.transaction_hash}:${processed.log_index || 0}`,
      kind: "incoming",
      title: `Incoming Protection #${number}`,
      guard,
      processedAmount: value(processed, "processedAmount"),
      protectedAmount: value(processed, "protectedAmount"),
      returnedAmount: value(processed, "availableAmount"),
      status: hasPosition ? "Completed" : "Pending",
      timestamp: processed.block_timestamp,
    }));
  }

  const manual = new Map<string, ActivityAnchor[]>();
  for (const event of items) {
    if (used.has(event)) continue;
    const guardId = value(event, "guardId");
    if (guardId) {
      const list = manual.get(guardId) || [];
      list.push(event);
      manual.set(guardId, list);
    }
  }
  for (const [guardId, events] of manual) {
    const positionIds = new Set(events.map(positionFor).filter(Boolean));
    for (const candidate of items) {
      if (!used.has(candidate) && positionFor(candidate) && positionIds.has(positionFor(candidate)) && ["PositionCreated", "Claimed"].includes(candidate.event_name)) events.push(candidate);
    }
    const unique = [...new Set(events)];
    unique.forEach((event) => used.add(event));
    const executed = unique.some((event) => event.event_name === "GuardExecuted");
    groups.push(groupFrom(unique, {
      key: `manual:${guardId}`,
      kind: "manual",
      title: `Manual Guard #${guardId}`,
      status: executed ? "Completed" : "Pending",
      timestamp: [...unique].sort(newestFirst)[0].block_timestamp,
    }));
  }

  for (const event of items) {
    if (used.has(event)) continue;
    groups.push(groupFrom([event], {
      key: `event:${event.transaction_hash}:${event.log_index ?? event.event_name}`,
      kind: "event",
      title: activityStepLabel(event),
      status: event.status === "Pending" ? "Pending" : "Confirmed",
      timestamp: event.block_timestamp,
    }));
  }
  return groups.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || b.logIndex - a.logIndex);
}
