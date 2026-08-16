import { assessEligibility } from "./eligibility.mjs";
import { validateDiscoveryEnvelope } from "./config.mjs";

export const guardAbi = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "protectBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "releaseDuration", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "processingCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "process", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256", name: "positionId" }] },
];
export const erc20Abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const brief = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : undefined;

export class AutomationExecutor {
  constructor({ config, publicClient, walletClient, store, fetchFn = fetch, logger = console, sleepFn = sleep, now = () => Date.now() }) {
    this.config = config; this.publicClient = publicClient; this.walletClient = walletClient; this.store = store; this.fetch = fetchFn; this.logger = logger; this.sleep = sleepFn; this.now = now; this.polling = false;
    this.status = { lastPollTimestamp: null, guardsDiscovered: 0, eligibleGuards: 0, lastSuccessfulExecution: null, lastError: null };
  }
  log(event, fields = {}) { this.logger.log(JSON.stringify({ event, ...fields })); }
  async retry(label, operation) { let last; for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) { try { return await operation(); } catch (error) { last = error; if (attempt === this.config.maxRetries) break; await this.sleep(this.config.retryBaseMs * 2 ** attempt); } } throw new Error(`${label} failed after ${this.config.maxRetries + 1} attempts: ${last?.message || last}`); }
  async discover() {
    const response = await this.retry("indexer discovery", () => this.fetch(`${this.config.indexerUrl}/incoming-guards`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
    validateDiscoveryEnvelope(response, this.config);
    const addresses = [...new Set(response.items.map((item) => item.payload?.guard?.toLowerCase()).filter((value) => /^0x[0-9a-f]{40}$/.test(value)))];
    this.status.guardsDiscovered = addresses.length; return addresses;
  }
  async readGuard(address) {
    const names = ["asset", "threshold", "owner", "protectBps", "releaseDuration", "processingCount"];
    const [chainId, ...values] = await Promise.all([this.publicClient.getChainId(), ...names.map((functionName) => this.publicClient.readContract({ address, abi: guardAbi, functionName }))]);
    const guard = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    guard.balance = await this.publicClient.readContract({ address: guard.asset, abi: erc20Abi, functionName: "balanceOf", args: [address] });
    return { chainId, ...guard };
  }
  async reconcilePending(address, state) {
    if (!state.lastSubmittedTxHash || state.lastConfirmedTxHash === state.lastSubmittedTxHash) return false;
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: state.lastSubmittedTxHash });
      if (receipt.status === "success") { const timestamp = new Date(this.now()).toISOString(); await this.store.update(address, { lastConfirmedTxHash: state.lastSubmittedTxHash, lastProcessedTimestamp: timestamp, failureTimestamp: null, failureReason: null }); this.status.lastSuccessfulExecution = { guard: address, txHash: state.lastSubmittedTxHash, timestamp }; this.log("Execution confirmed", { guard: brief(address), txHash: brief(state.lastSubmittedTxHash) }); }
      else await this.store.update(address, { lastSubmittedTxHash: null, failureTimestamp: this.now(), failureReason: "transaction_reverted" });
      return true;
    } catch (error) { if (/not found/i.test(error.message || "")) return true; throw error; }
  }
  async processGuard(address) {
    const state = this.store.get(address);
    if (await this.reconcilePending(address, state)) return { skipped: "pending_or_reconciled" };
    if (state.failureTimestamp && this.now() - Number(state.failureTimestamp) < this.config.failureCooldownMs) { this.log("Execution skipped", { guard: brief(address), reason: "cooldown" }); return { skipped: "cooldown" }; }
    try {
      let guard = await this.retry("guard reads", () => this.readGuard(address)); await this.store.update(address, { lastObservedBalance: guard.balance.toString() });
      let assessment = assessEligibility({ ...guard, expectedChainId: this.config.chainId, expectedAsset: this.config.usdc });
      if (!assessment.eligible) { this.log(assessment.reason === "below_threshold" ? "Guard below threshold" : "Execution skipped", { guard: brief(address), reason: assessment.reason }); return assessment; }
      this.log("Guard eligible", { guard: brief(address), balance: guard.balance.toString(), threshold: guard.threshold.toString() });
      guard = await this.retry("final guard reads", () => this.readGuard(address));
      assessment = assessEligibility({ ...guard, expectedChainId: this.config.chainId, expectedAsset: this.config.usdc }); if (!assessment.eligible) return assessment;
      const simulation = await this.retry("process simulation", () => this.publicClient.simulateContract({ address, abi: guardAbi, functionName: "process", account: this.walletClient?.account }));
      this.log("Simulation successful", { guard: brief(address) });
      if (!this.config.enabled || this.config.dryRun) { this.log("Execution skipped", { guard: brief(address), reason: !this.config.enabled ? "disabled" : "dry_run" }); return { simulated: true, broadcast: false }; }
      if (!this.walletClient?.account) throw new Error("Broadcasting requires the dedicated executor account");
      const [gas, fees] = await Promise.all([this.publicClient.estimateContractGas({ address, abi: guardAbi, functionName: "process", account: this.walletClient.account }), this.publicClient.estimateFeesPerGas()]);
      const effectiveFee = fees.maxFeePerGas ?? fees.gasPrice;
      if (gas > this.config.maxGasLimit || !effectiveFee || effectiveFee > this.config.maxFeePerGas) { this.log("Execution skipped", { guard: brief(address), reason: "gas_safety", gas: gas.toString(), fee: effectiveFee?.toString() }); return { skipped: "gas_safety" }; }
      const hash = await this.walletClient.writeContract({ ...simulation.request, gas, maxFeePerGas: effectiveFee });
      await this.store.update(address, { lastSubmittedTxHash: hash, submittedProcessingCount: guard.processingCount.toString() }); this.log("Execution submitted", { guard: brief(address), txHash: brief(hash) });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 }); if (receipt.status !== "success") throw new Error("Transaction reverted");
      const timestamp = new Date(this.now()).toISOString(); await this.store.update(address, { lastConfirmedTxHash: hash, lastProcessedTimestamp: timestamp, failureTimestamp: null, failureReason: null }); this.status.lastSuccessfulExecution = { guard: address, txHash: hash, timestamp }; this.log("Execution confirmed", { guard: brief(address), txHash: brief(hash) }); return { broadcast: true, hash };
    } catch (error) { const reason = error.message || String(error); await this.store.update(address, { failureTimestamp: this.now(), failureReason: reason }); this.log("Execution failed", { guard: brief(address), reason }); return { error: reason }; }
  }
  async poll() {
    if (this.polling) return { skipped: "poll_in_progress" }; this.polling = true; this.status.lastPollTimestamp = new Date(this.now()).toISOString(); this.status.eligibleGuards = 0;
    try { if (await this.publicClient.getChainId() !== this.config.chainId) throw new Error(`Wrong chain: executor requires ${this.config.chainId}`); const guards = await this.discover(); for (const guard of guards) { this.log("Guard discovered", { guard: brief(guard) }); const result = await this.processGuard(guard); if (result.eligible || result.simulated || result.broadcast) this.status.eligibleGuards++; } this.status.lastError = null; return { guards: guards.length }; }
    catch (error) { this.status.lastError = error.message || String(error); throw error; } finally { this.polling = false; }
  }
}
