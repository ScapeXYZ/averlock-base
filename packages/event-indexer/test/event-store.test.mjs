import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { deploymentIdentity, EVENT_UPSERT_SQL, newestFirst } from "../src/event-store.mjs";

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
