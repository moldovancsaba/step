/**
 * Server-only backend endpoints for the web miner. The browser never talks to
 * the gateway/mesh/chain directly — it calls this app's same-origin /api
 * routes, which proxy here. That avoids cross-service CORS and keeps the
 * topology identical to the iOS app (sign locally, submit to the gateway).
 */
export const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";
export const MESH_API_URL = process.env.MESH_API_URL ?? "http://127.0.0.1:9101";
export const STEP_RPC_URL = process.env.STEP_RPC_URL ?? "http://127.0.0.1:8545";
export const STEP_DEPLOYMENTS_FILE =
  process.env.STEP_DEPLOYMENTS_FILE ?? "contracts/deployments/31337.json";
