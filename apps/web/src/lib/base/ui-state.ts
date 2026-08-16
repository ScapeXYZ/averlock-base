export function splitPreview(protectPercent: string) {
  const value = Number(protectPercent);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return { protected: value, available: Number((100 - value).toFixed(2)) };
}

export function canProcess(balance: bigint, threshold: bigint, writesEnabled: boolean) {
  return writesEnabled && threshold > 0n && balance >= threshold;
}

export function cooldownState(state: number, eligibleAt: bigint, nowSeconds: bigint) {
  const eligible = (state === 2 || state === 3) && nowSeconds >= eligibleAt;
  return { eligible, remaining: eligible ? 0n : eligibleAt > nowSeconds ? eligibleAt - nowSeconds : 0n };
}

export function releaseProgress(start: bigint, end: bigint, now: bigint) {
  if (end <= start || now <= start) return 0;
  if (now >= end) return 100;
  return Number(((now - start) * 10_000n) / (end - start)) / 100;
}

export const incomingGuardFieldVisibility = {
  primary: ["Threshold", "Protect %", "Available %", "Release duration"],
  advanced: ["Rule ID"],
} as const;

export function canClaim(claimable: bigint, writesEnabled: boolean) {
  return writesEnabled && claimable > 0n;
}

export function walletBalancePresentation(eth: bigint, usdc: bigint) {
  return {
    eth: `${Number(eth) / 1e18 < 0.0001 ? "<0.0001" : (Number(eth) / 1e18).toFixed(4)} ETH`,
    usdc: `${(Number(usdc) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`,
  };
}
