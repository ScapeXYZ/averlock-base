import { bytesToHex, getAddress, type Address, type Hex } from "viem";

export type IncomingGuardDraft = {
  threshold: string;
  protectPercent: string;
  releaseDays: string;
};

export const guardTypeOptions = [
  "Manual / Cooldown Guard",
  "Incoming Funds Guard",
] as const;

export const emptyIncomingGuardDraft = (): IncomingGuardDraft => ({
  threshold: "",
  protectPercent: "",
  releaseDays: "30",
});

export function availablePercent(protectPercent: string): number | null {
  if (protectPercent.trim() === "") return null;
  const protect = Number(protectPercent);
  return Number.isFinite(protect) && protect >= 0 && protect <= 100
    ? 100 - protect
    : null;
}

export function validProtectPercent(value: string): boolean {
  if (value.trim() === "") return false;
  const percent = Number(value);
  return Number.isFinite(percent) && percent > 0 && percent <= 100;
}

export function canProcessIncoming(balance: bigint, threshold: bigint): boolean {
  return threshold > 0n && balance >= threshold;
}

export function isIncomingGuardRoute(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function generateRuleId(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  if (bytes.every((byte) => byte === 0)) bytes[31] = 1;
  return bytesToHex(bytes);
}

export type IncomingGuardAnchor = {
  guard: Address;
  owner: Address;
  ruleId: Hex;
  transactionHash: Hex;
};

const anchorKey = (owner: Address) =>
  `averlock:base:incoming-guards:${owner.toLowerCase()}`;

export function localIncomingGuards(owner: Address): IncomingGuardAnchor[] {
  if (typeof window === "undefined") return [];
  try {
    return (JSON.parse(localStorage.getItem(anchorKey(owner)) || "[]") as IncomingGuardAnchor[])
      .filter((item) => getAddress(item.owner) === getAddress(owner));
  } catch {
    return [];
  }
}

export function saveIncomingGuard(anchor: IncomingGuardAnchor) {
  const rest = localIncomingGuards(anchor.owner).filter(
    (item) => getAddress(item.guard) !== getAddress(anchor.guard),
  );
  localStorage.setItem(anchorKey(anchor.owner), JSON.stringify([anchor, ...rest]));
}
