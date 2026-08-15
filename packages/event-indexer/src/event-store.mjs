export const EVENT_UPSERT_SQL = `INSERT INTO events (transaction_hash,log_index,block_number,block_hash,contract_address,event_name,owner,guard_id,position_id,payload,block_timestamp,chain_id,status)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transaction_hash,log_index) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,contract_address=excluded.contract_address,event_name=excluded.event_name,owner=excluded.owner,guard_id=excluded.guard_id,position_id=excluded.position_id,payload=excluded.payload,block_timestamp=excluded.block_timestamp,chain_id=excluded.chain_id,status=excluded.status`;

export function deploymentIdentity(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

export function newestFirst(left, right) {
  return Number(BigInt(right.block_number) - BigInt(left.block_number)) || Number(right.log_index) - Number(left.log_index);
}

export function compatibleDeploymentIdentity(stored, current) {
  if (!stored || stored === current) return true;
  try {
    const previous = JSON.parse(stored);
    const next = JSON.parse(current);
    return previous.chainId === next.chainId &&
      JSON.stringify(previous.addresses) === JSON.stringify(next.addresses) &&
      previous.v2 === undefined;
  } catch {
    return false;
  }
}

export function activityRowsForDecoded({ decodedEventName, args, contractAddress, transactionHash, logIndex, blockNumber, blockHash, blockTimestamp, chainId, guardOwners }) {
  const guard = decodedEventName === "IncomingGuardCreated" ? args.guard?.toLowerCase() : undefined;
  const owner = (args.owner || args.beneficiary || (decodedEventName === "Transfer" ? guardOwners.get(args.to?.toLowerCase()) : "") || "").toLowerCase() || null;
  const eventName = decodedEventName === "Transfer" ? "IncomingFundsReceived" : decodedEventName;
  const payload = decodedEventName === "Transfer" ? { guard: args.to, sender: args.from, amount: args.value } : args;
  const common = [transactionHash, logIndex, blockNumber, blockHash, contractAddress.toLowerCase(), eventName, owner, args.guardId || null, args.positionId || null, JSON.stringify(payload), blockTimestamp, chainId, "Confirmed"];
  const rows = [common];
  if (decodedEventName === "IncomingFundsProcessed" && BigInt(args.availableAmount || 0) > 0n) {
    rows.push([transactionHash, logIndex + 1_000_000, blockNumber, blockHash, contractAddress.toLowerCase(), "AvailableFundsReturned", owner, null, args.positionId || null, JSON.stringify({ amount: args.availableAmount, positionId: args.positionId, guard: contractAddress }), blockTimestamp, chainId, "Confirmed"]);
  }
  return { guard, owner, rows };
}
