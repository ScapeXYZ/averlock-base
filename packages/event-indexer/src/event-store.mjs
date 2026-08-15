export const EVENT_UPSERT_SQL = `INSERT INTO events (transaction_hash,log_index,block_number,block_hash,contract_address,event_name,owner,guard_id,position_id,payload,block_timestamp,chain_id,status)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_hash,log_index) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,contract_address=excluded.contract_address,event_name=excluded.event_name,owner=excluded.owner,guard_id=excluded.guard_id,position_id=excluded.position_id,payload=excluded.payload,block_timestamp=excluded.block_timestamp,chain_id=excluded.chain_id,status=excluded.status`;

export function deploymentIdentity(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

export function newestFirst(left, right) {
  return Number(BigInt(right.block_number) - BigInt(left.block_number)) || Number(right.log_index) - Number(left.log_index);
}
