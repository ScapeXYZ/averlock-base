import type { Address, Hex } from "viem";

export function compactAddress(value?: Address | Hex, start = 6, end = 4) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}