#!/usr/bin/env bash

set -euo pipefail

if [ -f .env ]; then
  # shellcheck source=/dev/null
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${STEP_BACKEND_GATEWAY_URL:-}" ] || [ -z "${STEP_BACKEND_INDEXER_URL:-}" ]; then
  echo "Missing required non-sandbox backend bindings in .env:"
  echo "- STEP_BACKEND_GATEWAY_URL"
  echo "- STEP_BACKEND_INDEXER_URL"
  echo
  echo "Set both before deployment. Example:"
  echo "  STEP_BACKEND_GATEWAY_URL=https://gateway.example.com"
  echo "  STEP_BACKEND_INDEXER_URL=https://indexer.example.com"
  exit 1
fi

echo "Using Cloudflare deployment target account ${CLOUDFLARE_ACCOUNT_ID:+(account set)}"

echo "Cloudflare backend config:"
echo "  gateway: ${STEP_BACKEND_GATEWAY_URL}"
echo "  indexer: ${STEP_BACKEND_INDEXER_URL}"
if [ -n "${STEP_WEB_EXPLORER_URL:-}" ]; then
  echo "  explorer: ${STEP_WEB_EXPLORER_URL}"
fi
if [ -n "${STEP_WEB_MINER_URL:-}" ]; then
  echo "  miner: ${STEP_WEB_MINER_URL}"
fi

echo "Deploying worker..."
pnpm --dir apps/static-frontend deploy:cloudflare-worker

echo "Deployment done."
