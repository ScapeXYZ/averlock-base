export function humanizeError(error: unknown, fallback = "Something went wrong. Please try again.") {
  const raw = error && typeof error === "object" && "shortMessage" in error
    ? String((error as { shortMessage?: string }).shortMessage || "")
    : error instanceof Error ? error.message : String(error || "");
  const text = raw.toLowerCase();
  if (text.includes("user rejected") || text.includes("user denied")) return "Transaction rejected in wallet.";
  if (text.includes("insufficient") && (text.includes("usdc") || text.includes("balance"))) return "Not enough USDC in this wallet.";
  if (text.includes("threshold")) return "Your guard has not reached its threshold yet.";
  if (text.includes("rpc") || text.includes("fetch") || text.includes("network") || text.includes("getlogs") || text.includes("http request")) return "Base Sepolia RPC is temporarily unavailable.";
  return fallback;
}

export function ErrorMessage({ error, fallback }: { error: unknown; fallback?: string }) {
  const raw = error instanceof Error ? error.message : String(error || "");
  return <div className="error-message" role="alert"><p>{humanizeError(error, fallback)}</p>{raw && <details><summary>Technical details</summary><pre>{raw}</pre></details>}</div>;
}
