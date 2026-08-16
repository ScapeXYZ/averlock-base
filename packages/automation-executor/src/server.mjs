import http from "node:http";
import { createPublicClient, createWalletClient, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { loadConfig } from "./config.mjs";
import { AutomationExecutor } from "./executor.mjs";
import { JsonStateStore } from "./state-store.mjs";

const config = loadConfig();
const store = new JsonStateStore(config.statePath); await store.load();
let nextRpcAt = 0;
const pacedFetch = async (...args) => { const wait = Math.max(0, nextRpcAt - Date.now()); if (wait) await new Promise((resolve) => setTimeout(resolve, wait)); nextRpcAt = Date.now() + Math.ceil(1000 / config.rpcRequestsPerSecond); return fetch(...args); };
const transport = viemHttp(config.rpcUrl, { fetchFn: pacedFetch, retryCount: 0 });
const publicClient = createPublicClient({ chain: baseSepolia, transport });
const account = config.privateKey ? privateKeyToAccount(config.privateKey) : undefined;
const walletClient = account ? createWalletClient({ account, chain: baseSepolia, transport }) : undefined;
const executor = new AutomationExecutor({ config, publicClient, walletClient, store });
const safePoll = () => executor.poll().catch((error) => console.error(JSON.stringify({ event: "Poll failed", reason: error.message || String(error) })));
safePoll(); setInterval(safePoll, config.pollIntervalMs).unref();
function reply(response, status, body) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)); }
http.createServer((request, response) => {
  const path = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  if (request.method !== "GET") return reply(response, 405, { error: "Method not allowed" });
  const body = { service: config.serviceName, chainId: config.chainId, enabled: config.enabled, dryRun: config.dryRun, ...executor.status };
  if (path === "/health") return reply(response, executor.status.lastError ? 503 : 200, body);
  if (path === "/status") return reply(response, 200, body);
  return reply(response, 404, { error: "Not found" });
}).listen(config.port, "0.0.0.0", () => console.log(JSON.stringify({ event: "Service started", service: config.serviceName, chainId: config.chainId, enabled: config.enabled, dryRun: config.dryRun })));
