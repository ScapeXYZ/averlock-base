# AVERLOCK Automation Executor

Base Sepolia-only worker for permissionlessly calling `IncomingFundsGuardAccount.process()`. It discovers guards through the AVERLOCK event indexer's `/incoming-guards` route, then treats RPC contract reads and simulation as authoritative. It never scans chain logs itself.

Broadcasting is opt-in twice: `AVERLOCK_EXECUTOR_ENABLED=true` and `AVERLOCK_EXECUTOR_DRY_RUN=false`. Defaults are disabled and dry-run. A private key is unnecessary for disabled/dry-run operation and required only for broadcasting. Use a dedicated gas-only executor wallet; never use a user or deployer key.

## Run

From the repository root:

```sh
npm install
npm test --workspace @averlock/automation-executor
npm start --workspace @averlock/automation-executor
```

Copy `.env.example` to an untracked environment configuration and set `AVERLOCK_EXECUTOR_RPC_URL`. The production indexer must first include the new `/incoming-guards` endpoint. For a safe first run, leave `AVERLOCK_EXECUTOR_ENABLED=false` and `AVERLOCK_EXECUTOR_DRY_RUN=true`.

`/health` returns 503 after a poll error and `/status` always returns operational state. Neither endpoint contains RPC URLs, wallet addresses, or secrets.

State is stored atomically at `AVERLOCK_EXECUTOR_STATE_PATH`. Railway should mount persistent storage for its parent directory before broadcasting. Each guard retains last observed balance, submitted and confirmed transaction hashes, processing timestamp, and failure details. Guard work is deliberately bounded to one-at-a-time. A confirmed guard is not permanently completed, so future qualifying deposits can create later protection cycles.

The only non-view ABI entry in the worker is `process()`. There is no generic contract call endpoint or arbitrary calldata configuration.
