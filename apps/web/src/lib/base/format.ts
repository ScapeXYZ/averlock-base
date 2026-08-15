import type { Address, Hex } from "viem";

export function compactAddress(value?: Address | Hex, start = 6, end = 4) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function formatBlockTimestamp(timestamp: number | bigint, locale = "en-US") {
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isFinite(milliseconds)) return "—";
  const parts = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(new Date(milliseconds));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")} ${part("day")}, ${part("year")} · ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}
