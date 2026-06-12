import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { parseProtocolParams } from "@step/shared-types";
import { createApp } from "./app.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const params = parseProtocolParams(
  JSON.parse(readFileSync(env("STEP_PROTOCOL_PARAMS"), "utf8")),
);
const app = createApp({
  adminToken: env("FOUNDATION_API_TOKEN"),
  referencePriceEurPerStep: params.referencePriceEurPerStep,
  trinityPerStep: params.trinityPerStep,
});
const port = Number(process.env.EXCHANGE_PORT ?? 8096);
console.log(`exchange-service (closed campaign credits only) listening on :${port}`);
serve({ fetch: app.fetch, port });
