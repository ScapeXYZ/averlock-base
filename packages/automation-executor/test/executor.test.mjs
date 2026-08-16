import test from "node:test";
import assert from "node:assert/strict";
import { AutomationExecutor, guardAbi } from "../src/executor.mjs";
import { MemoryStateStore } from "../src/state-store.mjs";
import { BASE_SEPOLIA_USDC, INCOMING_GUARD_FACTORY } from "../src/config.mjs";

const guard = "0x1111111111111111111111111111111111111111";
const account = { address: "0x2222222222222222222222222222222222222222" };
const hash = `0x${"a".repeat(64)}`;
function harness(overrides = {}) {
  const calls = { writes: 0, simulations: 0, reads: 0, sleeps: [] }; let balance = overrides.balance ?? 100n; let processingCount = overrides.processingCount ?? 0n;
  const config = { chainId: 84532, usdc: BASE_SEPOLIA_USDC, factory: INCOMING_GUARD_FACTORY, startBlock: 45527065n, indexerUrl: "https://indexer.test", enabled: overrides.enabled ?? true, dryRun: overrides.dryRun ?? false, maxRetries: overrides.maxRetries ?? 0, retryBaseMs: 10, failureCooldownMs: overrides.failureCooldownMs ?? 1000, maxGasLimit: overrides.maxGasLimit ?? 500000n, maxFeePerGas: overrides.maxFeePerGas ?? 2000000000n };
  const publicClient = {
    getChainId: async () => overrides.chainId ?? 84532,
    readContract: async ({ functionName }) => { calls.reads++; if (functionName === "asset") return overrides.asset ?? BASE_SEPOLIA_USDC; if (functionName === "threshold") return 100n; if (functionName === "owner") return account.address; if (functionName === "protectBps") return 5000; if (functionName === "releaseDuration") return 86400n; if (functionName === "processingCount") return processingCount; if (functionName === "balanceOf") return balance; throw new Error("unexpected read"); },
    simulateContract: async () => { calls.simulations++; if (overrides.simulationError) throw new Error("simulation reverted"); return { request: { address: guard, abi: guardAbi, functionName: "process", account } }; },
    estimateContractGas: async () => overrides.gas ?? 200000n, estimateFeesPerGas: async () => ({ maxFeePerGas: overrides.fee ?? 1000000000n }),
    waitForTransactionReceipt: async () => { balance = 0n; processingCount++; return { status: "success" }; }, getTransactionReceipt: async () => ({ status: "success" }),
  };
  const walletClient = { account, writeContract: async () => { calls.writes++; return hash; } };
  const store = new MemoryStateStore();
  const fetchFn = async () => ({ ok: true, json: async () => ({ chainId: overrides.indexerChainId ?? 84532, factory: overrides.indexerFactory ?? INCOMING_GUARD_FACTORY, startBlock: "45527065", items: [{ payload: { guard } }] }) });
  const executor = new AutomationExecutor({ config, publicClient, walletClient, store, fetchFn, logger: { log() {} }, sleepFn: async (ms) => calls.sleeps.push(ms), now: overrides.now || (() => 10000) });
  return { executor, calls, store, setBalance: (value) => { balance = value; } };
}

test("dry-run never broadcasts", async () => { const h = harness({ dryRun: true }); await h.executor.poll(); assert.equal(h.calls.simulations, 1); assert.equal(h.calls.writes, 0); });
test("disabled executor never broadcasts", async () => { const h = harness({ enabled: false }); await h.executor.poll(); assert.equal(h.calls.simulations, 1); assert.equal(h.calls.writes, 0); });
test("failed simulation never broadcasts", async () => { const h = harness({ simulationError: true }); await h.executor.poll(); assert.equal(h.calls.writes, 0); assert.match(h.store.get(guard).failureReason, /simulation/); });
test("successful simulation broadcasts only when explicitly enabled", async () => { const h = harness(); await h.executor.poll(); assert.equal(h.calls.writes, 1); assert.equal(h.store.get(guard).lastConfirmedTxHash, hash); });
test("duplicate poll does not double-submit a confirmed unchanged cycle", async () => { const h = harness(); await h.executor.poll(); await h.executor.poll(); assert.equal(h.calls.writes, 1); });
test("confirmed guard can process a later second deposit cycle", async () => { const h = harness(); await h.executor.poll(); h.setBalance(150n); await h.executor.poll(); assert.equal(h.calls.writes, 2); });
test("wrong chain is rejected before discovery", async () => { const h = harness({ chainId: 8453 }); await assert.rejects(h.executor.poll(), /Wrong chain/); assert.equal(h.calls.writes, 0); });
test("wrong token from onchain reads is rejected", async () => { const h = harness({ asset: "0x0000000000000000000000000000000000000001" }); await h.executor.poll(); assert.equal(h.calls.simulations, 0); assert.equal(h.calls.writes, 0); });
test("indexer result is independently revalidated onchain", async () => { const h = harness({ balance: 99n }); await h.executor.poll(); assert.ok(h.calls.reads >= 7); assert.equal(h.calls.writes, 0); });
test("retry uses exponential backoff and is bounded", async () => { const h = harness({ simulationError: true, maxRetries: 2 }); await h.executor.poll(); assert.deepEqual(h.calls.sleeps, [10, 20]); assert.equal(h.calls.simulations, 3); });
test("gas limit and fee ceilings prevent broadcast", async () => { const gas = harness({ gas: 500001n }); await gas.executor.poll(); const fee = harness({ fee: 2000000001n }); await fee.executor.poll(); assert.equal(gas.calls.writes + fee.calls.writes, 0); });
test("overlapping polls are prevented", async () => { const h = harness(); h.executor.polling = true; assert.deepEqual(await h.executor.poll(), { skipped: "poll_in_progress" }); assert.equal(h.calls.writes, 0); });
test("discovery rejects an indexer envelope for another factory", async () => { const h = harness({ indexerFactory: "0x0000000000000000000000000000000000000001" }); await assert.rejects(h.executor.poll(), /wrong factory/); assert.equal(h.calls.reads, 0); });
test("executor exposes no generic arbitrary-call method", () => { const h = harness(); assert.equal(h.executor.callContract, undefined); assert.deepEqual(guardAbi.filter((entry) => entry.stateMutability === "nonpayable").map((entry) => entry.name), ["process"]); });
