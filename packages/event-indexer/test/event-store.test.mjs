import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { activityRowsForDecoded, compatibleDeploymentIdentity, deploymentIdentity, EVENT_UPSERT_SQL, newestFirst } from "../src/event-store.mjs";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE events (transaction_hash TEXT NOT NULL,log_index INTEGER NOT NULL,block_number TEXT NOT NULL,block_hash TEXT NOT NULL,contract_address TEXT NOT NULL,event_name TEXT NOT NULL,owner TEXT,guard_id TEXT,position_id TEXT,payload TEXT NOT NULL,block_timestamp TEXT,chain_id INTEGER,status TEXT,PRIMARY KEY(transaction_hash,log_index))`);
  return db;
}

test("event upserts are restart-safe and idempotent", () => {
  const db = database();
  const insert = db.prepare(EVENT_UPSERT_SQL);
  const values = ["0xtx", 2, "45527066", "0xblock", "0xguard", "IncomingFundsProcessed", "0xowner", null, "1", "{}", "1786831740", 84532, "Confirmed"];
  insert.run(...values);
  insert.run(...values);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events").get().count, 1);
});

test("deployment identity separates chains and serializes block numbers", () => {
  const sepolia = deploymentIdentity({ chainId: 84532, startBlock: 45527065n });
  assert.notEqual(sepolia, deploymentIdentity({ chainId: 8453, startBlock: 45527065n }));
  assert.match(sepolia, /45527065/);
});

test("activity ordering is newest block then newest log", () => {
  const rows = [{ block_number: "9", log_index: 8 }, { block_number: "10", log_index: 1 }, { block_number: "10", log_index: 3 }];
  assert.deepEqual(rows.sort(newestFirst).map((row) => row.log_index), [3, 1, 8]);
});

test("a pre-V2 database identity can be safely upgraded only for the same legacy deployment", () => {
  const legacy = deploymentIdentity({ chainId: 84532, addresses: ["manager", "vault"] });
  const withV2 = deploymentIdentity({ chainId: 84532, addresses: ["manager", "vault"], v2: { factory: "factory" } });
  assert.equal(compatibleDeploymentIdentity(legacy, withV2), true);
  assert.equal(compatibleDeploymentIdentity(legacy, deploymentIdentity({ chainId: 8453, addresses: ["manager", "vault"], v2: { factory: "factory" } })), false);
});

test("V2 activity relates factory guard, funding, 5 USDC processing, position #1, and claim to its owner", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const guard = "0x9d865a14cae66f51f8d9183b34929913f8e13591";
  const guardOwners = new Map();
  const base = { contractAddress: guard, transactionHash: "0xtx", logIndex: 1, blockNumber: "45527065", blockHash: "0xblock", blockTimestamp: "1786831740", chainId: 84532, guardOwners };
  const created = activityRowsForDecoded({ ...base, decodedEventName: "IncomingGuardCreated", args: { guard, owner, ruleId: "0xrule" } });
  guardOwners.set(created.guard, created.owner);
  const received = activityRowsForDecoded({ ...base, decodedEventName: "Transfer", args: { from: "0xsender", to: guard, value: "5000000" } });
  const processed = activityRowsForDecoded({ ...base, decodedEventName: "IncomingFundsProcessed", args: { owner, processedAmount: "5000000", protectedAmount: "3500000", availableAmount: "1500000", positionId: "1" } });
  const position = activityRowsForDecoded({ ...base, decodedEventName: "PositionCreated", args: { beneficiary: owner, amount: "3500000", positionId: "1" } });
  const claim = activityRowsForDecoded({ ...base, decodedEventName: "Claimed", args: { beneficiary: owner, amount: "500000", positionId: "1" } });
  const rows = [created, received, processed, position, claim].flatMap((result) => result.rows);
  assert.deepEqual(rows.map((row) => row[5]), ["IncomingGuardCreated", "IncomingFundsReceived", "IncomingFundsProcessed", "AvailableFundsReturned", "PositionCreated", "Claimed"]);
  assert.ok(rows.every((row) => row[6] === owner));
  assert.equal(JSON.parse(rows[1][9]).amount, "5000000");
  assert.equal(JSON.parse(rows[2][9]).protectedAmount, "3500000");
  assert.equal(JSON.parse(rows[3][9]).amount, "1500000");
  assert.equal(rows[4][8], "1");
});
