import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, decodeEventLog, http as viemHttp, isAddress, parseAbiItem, zeroAddress } from "viem";
import { createRateLimitedFetch, requestsPerSecond } from "./rpc-pacer.mjs";
import { activityRowsForDecoded, compatibleDeploymentIdentity, deploymentIdentity, EVENT_UPSERT_SQL } from "./event-store.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const number = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
};
let addresses;
let v2;
let config;
let configurationError;
try {
  addresses = required("AVERLOCK_CONTRACT_ADDRESSES").split(",").map((value) => value.trim().toLowerCase());
  if (
    addresses.length !== 2 ||
    addresses.some((address) => !isAddress(address) || address === zeroAddress) ||
    addresses[0] === addresses[1]
  ) {
    throw new Error(
      "AVERLOCK_CONTRACT_ADDRESSES must contain exactly GuardManager then ProtectionVault as distinct non-zero addresses",
    );
  }
  const v2Factory = process.env.AVERLOCK_V2_FACTORY_ADDRESS?.trim().toLowerCase();
  const v2Vault = process.env.AVERLOCK_V2_VAULT_ADDRESS?.trim().toLowerCase();
  const usdc = process.env.AVERLOCK_USDC_ADDRESS?.trim().toLowerCase();
  if ([v2Factory, v2Vault, usdc].some((value) => value && (!isAddress(value) || value === zeroAddress))) throw new Error("V2 factory, vault, and USDC must be valid non-zero addresses");
  if ([v2Factory, v2Vault, usdc].some(Boolean) && ![v2Factory, v2Vault, usdc].every(Boolean)) throw new Error("AVERLOCK_V2_FACTORY_ADDRESS, AVERLOCK_V2_VAULT_ADDRESS, and AVERLOCK_USDC_ADDRESS must be configured together");
  v2 = v2Factory ? { factory: v2Factory, vault: v2Vault, usdc, startBlock: BigInt(process.env.AVERLOCK_V2_START_BLOCK || required("AVERLOCK_START_BLOCK")) } : undefined;
  config = {
    chainId: number("AVERLOCK_CHAIN_ID", 84532),
    startBlock: BigInt(required("AVERLOCK_START_BLOCK")), confirmations: number("AVERLOCK_CONFIRMATIONS", 12),
    overlap: number("AVERLOCK_REORG_OVERLAP", 24),
    range: Math.max(number("AVERLOCK_LOG_BLOCK_RANGE", 2_000), 1),
    requestsPerSecond: requestsPerSecond(process.env.AVERLOCK_RPC_REQUESTS_PER_SECOND ?? "2"),
    rpcUrl: required("AVERLOCK_RPC_URL"), dbPath: process.env.AVERLOCK_INDEXER_DB_PATH || "./data/averlock-events.sqlite",
  };
} catch (error) {
  configurationError = error instanceof Error ? error.message : String(error);
  // Keep health reporting available for an operator to see the fatal error.
  addresses = ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"];
  config = { chainId: 84532, startBlock: 0n, confirmations: 12, overlap: 24, range: 2_000, requestsPerSecond: 2, rpcUrl: "http://127.0.0.1:0", dbPath: process.env.AVERLOCK_INDEXER_DB_PATH || "./data/averlock-events.sqlite" };
}
mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_processed_block TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL, block_number TEXT NOT NULL, block_hash TEXT NOT NULL,
  contract_address TEXT NOT NULL, event_name TEXT NOT NULL, owner TEXT, guard_id TEXT,
  position_id TEXT, payload TEXT NOT NULL, PRIMARY KEY (transaction_hash, log_index)
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_owner_block ON events(owner, block_number);
CREATE INDEX IF NOT EXISTS events_guard_block ON events(guard_id, block_number);`);
for (const statement of ["ALTER TABLE events ADD COLUMN block_timestamp TEXT", "ALTER TABLE events ADD COLUMN chain_id INTEGER", "ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'Confirmed'"]) {
  try { db.exec(statement); } catch (error) { if (!String(error).includes("duplicate column name")) throw error; }
}
const identity = deploymentIdentity({ chainId: config.chainId, addresses, v2 });
const storedIdentity = db.prepare("SELECT value FROM metadata WHERE key = 'deployment_identity'").get()?.value;
if (!compatibleDeploymentIdentity(storedIdentity, identity)) configurationError = `Database deployment identity mismatch; use a separate database for chain ${config.chainId}`;
else db.prepare("INSERT INTO metadata(key,value) VALUES('deployment_identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(identity);
db.prepare("UPDATE events SET chain_id = ? WHERE chain_id IS NULL").run(config.chainId);
db.prepare("UPDATE events SET status = 'Confirmed' WHERE status IS NULL").run();
const cursor = db.prepare("SELECT last_processed_block FROM cursor WHERE id = 1");
const setCursor = db.prepare("INSERT INTO cursor (id,last_processed_block) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET last_processed_block=excluded.last_processed_block");
const deleteFrom = db.prepare("DELETE FROM events WHERE CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)");
const insert = db.prepare(EVENT_UPSERT_SQL);
const v2BackfillKey = v2 ? `v2_activity_backfill:${deploymentIdentity(v2)}` : undefined;
if (!configurationError && v2BackfillKey && !db.prepare("SELECT value FROM metadata WHERE key = ?").get(v2BackfillKey)) {
  db.exec("BEGIN");
  try {
    const saved = cursor.get();
    if (saved && BigInt(saved.last_processed_block) >= v2.startBlock) setCursor.run((v2.startBlock - 1n).toString());
    db.prepare("INSERT INTO metadata(key,value) VALUES(?, 'in_progress')").run(v2BackfillKey);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
// This fetch sits below viem, so every JSON-RPC method shares one process-wide pace.
// In particular, the concurrent event filters cannot create an HTTP burst.
const rpcFetch = createRateLimitedFetch({
  requestsPerSecond: config.requestsPerSecond,
  onRetry: ({ attempt, delay, retryAfter }) => console.warn(`Base RPC 429; retry ${attempt} in ${delay}ms${retryAfter ? " (Retry-After)" : ""}`),
});
const client = createPublicClient({ transport: viemHttp(config.rpcUrl, { fetchFn: rpcFetch, timeout: 0, retryCount: 0 }) });

const manualEvents = [
  [addresses[0], parseAbiItem("event GuardCreated(uint256 indexed guardId,address indexed owner,address indexed asset,uint8 guardType,uint256 amount,uint64 cooldown,uint64 releaseDuration,uint64 createdAt)")],
  [addresses[0], parseAbiItem("event GuardFunded(uint256 indexed guardId,address indexed owner,address indexed asset,uint256 amount,uint64 fundedAt,uint64 eligibleAt)")],
  [addresses[0], parseAbiItem("event GuardStateChanged(uint256 indexed guardId,address indexed owner,uint8 previousState,uint8 newState,uint64 changedAt)")],
  [addresses[0], parseAbiItem("event GuardExecuted(uint256 indexed guardId,address indexed owner,uint256 indexed positionId,address asset,uint256 amount,uint64 executedAt)")],
  [addresses[0], parseAbiItem("event GuardCompleted(uint256 indexed guardId,address indexed owner,uint256 indexed positionId,uint64 completedAt)")],
  [addresses[0], parseAbiItem("event GuardDeactivated(uint256 indexed guardId,address indexed owner,uint64 deactivatedAt)")],
  [addresses[1], parseAbiItem("event PositionCreated(uint256 indexed positionId, address indexed depositor, address indexed beneficiary, address asset, uint256 amount, uint64 startTimestamp, uint64 endTimestamp, uint64 createdAt)")],
  [addresses[1], parseAbiItem("event Claimed(uint256 indexed positionId, address indexed beneficiary, address indexed asset, uint256 amount, uint256 totalClaimed)")],
];
const incomingGuardCreated = parseAbiItem("event IncomingGuardCreated(address indexed guard,address indexed owner,bytes32 indexed ruleId,address asset,address vault,uint256 threshold,uint16 protectBps,uint64 releaseDuration,uint64 createdAt)");
const incomingFundsProcessed = parseAbiItem("event IncomingFundsProcessed(bytes32 indexed ruleId,address indexed owner,address indexed processor,address asset,uint256 processedAmount,uint256 protectedAmount,uint256 availableAmount,uint256 positionId,uint64 startTimestamp,uint64 endTimestamp)");
const transfer = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const positionCreated = parseAbiItem("event PositionCreated(uint256 indexed positionId,address indexed depositor,address indexed beneficiary,address asset,uint256 amount,uint64 startTimestamp,uint64 endTimestamp,uint64 createdAt)");
const claimed = parseAbiItem("event Claimed(uint256 indexed positionId,address indexed beneficiary,address indexed asset,uint256 amount,uint256 totalClaimed)");
const staticEvents = v2 ? [...manualEvents, [v2.factory, incomingGuardCreated], [v2.vault, positionCreated], [v2.vault, claimed]] : manualEvents;
const events = [...staticEvents, ...(v2 ? [[v2.usdc, transfer], [zeroAddress, incomingFundsProcessed]] : [])];
function normalize(value) { return typeof value === "bigint" ? value.toString() : value; }
function decode(log) {
  for (const [, event] of events) {
    try { const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics }); if (decoded.eventName === event.name) return decoded; } catch { /* try next AVERLOCK event */ }
  }
  return undefined;
}
async function retry(label, fn) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await fn(); } catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 300 * 2 ** attempt))); }
  }
  throw new Error(`${label} failed after bounded retries: ${last instanceof Error ? last.message : String(last)}`);
}
let lastError; let syncing = false; let lastChainHead; let lastSafeHead;
async function sync() {
  if (syncing) return; syncing = true;
  try {
    const head = await retry("block number", () => client.getBlockNumber());
    const safeHead = head > BigInt(config.confirmations) ? head - BigInt(config.confirmations) : 0n;
    lastChainHead = head; lastSafeHead = safeHead;
    const missingTimestamps = db.prepare("SELECT DISTINCT block_number FROM events WHERE chain_id = ? AND block_timestamp IS NULL").all(config.chainId);
    for (const row of missingTimestamps) {
      const block = await retry(`timestamp backfill block ${row.block_number}`, () => client.getBlock({ blockNumber: BigInt(row.block_number) }));
      db.prepare("UPDATE events SET block_timestamp = ? WHERE chain_id = ? AND block_number = ?").run(block.timestamp.toString(), config.chainId, row.block_number);
    }
    const saved = cursor.get();
    let from = saved ? BigInt(saved.last_processed_block) + 1n - BigInt(config.overlap) : config.startBlock;
    if (from < config.startBlock) from = config.startBlock;
    if (saved) { deleteFrom.run(from.toString()); setCursor.run((from - 1n).toString()); }
    while (from <= safeHead) {
      const to = from + BigInt(config.range - 1) > safeHead ? safeHead : from + BigInt(config.range - 1);
      // Static queries are restricted to configured AVERLOCK contracts.
      const batches = await Promise.all(staticEvents.map(([address, event]) => retry(`${event.name} logs ${from}-${to}`, () => client.getLogs({ address, event, fromBlock: from, toBlock: to }))));
      const logs = batches.flat();
      const knownGuardRows = db.prepare("SELECT owner,payload FROM events WHERE chain_id = ? AND event_name = 'IncomingGuardCreated'").all(config.chainId);
      const guardOwners = new Map(knownGuardRows.map((row) => { const payload = JSON.parse(row.payload); return [payload.guard.toLowerCase(), row.owner]; }));
      for (const log of logs) {
        const decoded = decode(log);
        if (decoded?.eventName === "IncomingGuardCreated") guardOwners.set(decoded.args.guard.toLowerCase(), decoded.args.owner.toLowerCase());
      }
      if (v2 && guardOwners.size && to >= v2.startBlock) {
        const guards = [...guardOwners.keys()];
        const [processed, received] = await Promise.all([
          retry(`IncomingFundsProcessed logs ${from}-${to}`, () => client.getLogs({ address: guards, event: incomingFundsProcessed, fromBlock: from < v2.startBlock ? v2.startBlock : from, toBlock: to })),
          retry(`guard funding transfers ${from}-${to}`, () => client.getLogs({ address: v2.usdc, event: transfer, args: { to: guards }, fromBlock: from < v2.startBlock ? v2.startBlock : from, toBlock: to })),
        ]);
        logs.push(...processed, ...received);
      }
      const timestamps = new Map();
      await Promise.all([...new Set(logs.map((log) => log.blockNumber?.toString()).filter(Boolean))].map(async (blockNumber) => {
        const block = await retry(`block ${blockNumber}`, () => client.getBlock({ blockNumber: BigInt(blockNumber) }));
        timestamps.set(blockNumber, block.timestamp.toString());
      }));
      db.exec("BEGIN");
      try {
        for (const log of logs) {
          const decoded = decode(log); if (!decoded || !log.transactionHash || log.logIndex == null || !log.blockHash || !log.blockNumber) continue;
          const args = Object.fromEntries(Object.entries(decoded.args).map(([key, value]) => [key, normalize(value)]));
          const timestamp = timestamps.get(log.blockNumber.toString());
          const projected = activityRowsForDecoded({ decodedEventName: decoded.eventName, args, contractAddress: log.address, transactionHash: log.transactionHash, logIndex: Number(log.logIndex), blockNumber: log.blockNumber.toString(), blockHash: log.blockHash, blockTimestamp: timestamp, chainId: config.chainId, guardOwners });
          if (projected.guard && projected.owner) guardOwners.set(projected.guard, projected.owner);
          for (const row of projected.rows) insert.run(...row);
        }
        setCursor.run(to.toString()); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      from = to + 1n;
    }
    if (v2BackfillKey) db.prepare("UPDATE metadata SET value = 'complete' WHERE key = ?").run(v2BackfillKey);
    lastError = undefined;
  } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  finally { syncing = false; }
}
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
function syncStatus() {
  const saved = cursor.get(); const indexed = saved ? BigInt(saved.last_processed_block) : config.startBlock - 1n;
  const lagBlocks = lastSafeHead === undefined ? undefined : lastSafeHead > indexed ? lastSafeHead - indexed : 0n;
  const rpc = rpcFetch.status();
  const status = configurationError ? "fatal_configuration_error" : rpc.retrying ? "rate_limited" : syncing ? "syncing" : lastError ? "retrying" : "healthy";
  return { status, chainId: config.chainId, syncing, retrying: rpc.retrying || Boolean(lastError), rpcRequestsPerSecond: config.requestsPerSecond, retryAfter: rpc.blockedUntil ? new Date(rpc.blockedUntil).toISOString() : undefined, startBlock: config.startBlock.toString(), v2StartBlock: v2?.startBlock.toString(), lastProcessedBlock: indexed.toString(), chainHead: lastChainHead?.toString(), safeHead: lastSafeHead?.toString(), lagBlocks: lagBlocks?.toString(), confirmations: config.confirmations, reorgOverlap: config.overlap, lastError, configurationError };
}
const rowsForOwner = db.prepare("SELECT * FROM events WHERE chain_id = ? AND owner = ? ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC LIMIT 500");
const guardsForOwner = db.prepare("SELECT * FROM events WHERE chain_id = ? AND owner = ? AND event_name = 'GuardCreated' ORDER BY CAST(block_number AS INTEGER) DESC LIMIT 100");
const incomingGuards = db.prepare("SELECT * FROM events WHERE chain_id = ? AND event_name = 'IncomingGuardCreated' AND contract_address = ? AND CAST(block_number AS INTEGER) >= CAST(? AS INTEGER) ORDER BY CAST(block_number AS INTEGER) ASC, log_index ASC LIMIT 5000");
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
  if (url.pathname === "/health") return json(response, lastError || configurationError ? 503 : 200, { ...syncStatus(), service: "averlock-base-sepolia-event-indexer" });
  if (url.pathname === "/sync") return json(response, 200, syncStatus());
  if (url.pathname === "/incoming-guards") {
    if (!v2) return json(response, 503, { error: "V2 indexer configuration is unavailable" });
    return json(response, 200, { chainId: config.chainId, factory: v2.factory, startBlock: v2.startBlock.toString(), items: incomingGuards.all(config.chainId, v2.factory, v2.startBlock.toString()).map((row) => ({ ...row, payload: JSON.parse(row.payload) })), sync: syncStatus() });
  }
  const owner = url.searchParams.get("owner")?.toLowerCase();
  if ((url.pathname === "/activity" || url.pathname === "/guards") && !/^0x[0-9a-f]{40}$/.test(owner || "")) return json(response, 400, { error: "A valid owner address is required" });
  if (url.pathname === "/activity") return json(response, 200, { chainId: config.chainId, items: rowsForOwner.all(config.chainId, owner).map((row) => ({ ...row, payload: JSON.parse(row.payload) })), sync: syncStatus() });
  if (url.pathname === "/guards") return json(response, 200, { chainId: config.chainId, items: guardsForOwner.all(config.chainId, owner).map((row) => ({ ...row, payload: JSON.parse(row.payload) })), sync: syncStatus() });
  return json(response, 404, { error: "Not found" });
});
server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => {
  console.log("AVERLOCK event indexer listening");
  if (configurationError) console.error(`Fatal AVERLOCK event-indexer configuration error: ${configurationError}`);
  else { sync(); setInterval(sync, 15_000).unref(); }
});
