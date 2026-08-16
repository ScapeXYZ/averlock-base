import { isAddress, parseGwei } from "viem";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const INCOMING_GUARD_FACTORY = "0x355c5ECB31EA54092f56263c591B44f156B325C5";
export const V2_START_BLOCK = 45527065n;
function bool(name, fallback) { const value = process.env[name]; if (value === undefined) return fallback; if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false`); return value === "true"; }
function integer(name, fallback, minimum = 0) { const value = Number(process.env[name] ?? fallback); if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`); return value; }
export function loadConfig() {
  const enabled = bool("AVERLOCK_EXECUTOR_ENABLED", false); const dryRun = bool("AVERLOCK_EXECUTOR_DRY_RUN", true);
  const rpcUrl = process.env.AVERLOCK_EXECUTOR_RPC_URL?.trim(); if (!rpcUrl) throw new Error("AVERLOCK_EXECUTOR_RPC_URL is required");
  const privateKey = process.env.AVERLOCK_EXECUTOR_PRIVATE_KEY?.trim();
  if (enabled && !dryRun && !/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("AVERLOCK_EXECUTOR_PRIVATE_KEY is required for broadcasting and must be a 32-byte hex key");
  return { serviceName: "averlock-automation-executor", chainId: BASE_SEPOLIA_CHAIN_ID, enabled, dryRun, rpcUrl, privateKey, indexerUrl: new URL(process.env.AVERLOCK_EXECUTOR_INDEXER_URL || "https://averlock-indexer-production.up.railway.app").toString().replace(/\/$/, ""), pollIntervalMs: integer("AVERLOCK_EXECUTOR_POLL_INTERVAL_MS", 20000, 15000), rpcRequestsPerSecond: integer("AVERLOCK_EXECUTOR_RPC_REQUESTS_PER_SECOND", 2, 1), maxRetries: integer("AVERLOCK_EXECUTOR_MAX_RETRIES", 4), retryBaseMs: integer("AVERLOCK_EXECUTOR_RETRY_BASE_MS", 500, 1), failureCooldownMs: integer("AVERLOCK_EXECUTOR_FAILURE_COOLDOWN_MS", 300000, 1), maxGasLimit: BigInt(integer("AVERLOCK_EXECUTOR_MAX_GAS_LIMIT", 500000, 21000)), maxFeePerGas: parseGwei(process.env.AVERLOCK_EXECUTOR_MAX_FEE_PER_GAS_GWEI || "2"), statePath: process.env.AVERLOCK_EXECUTOR_STATE_PATH || "./data/executor-state.json", port: integer("PORT", 8080, 1), factory: INCOMING_GUARD_FACTORY, usdc: BASE_SEPOLIA_USDC, startBlock: V2_START_BLOCK };
}
export function validateDiscoveryEnvelope(body, config) { if (body?.chainId !== config.chainId) throw new Error(`Indexer returned wrong chain ${body?.chainId}`); if (!isAddress(body.factory) || body.factory.toLowerCase() !== config.factory.toLowerCase()) throw new Error("Indexer returned wrong factory"); if (BigInt(body.startBlock) !== config.startBlock) throw new Error("Indexer returned wrong V2 start block"); }
