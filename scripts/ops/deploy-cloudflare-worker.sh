#!/usr/bin/env bash

set -euo pipefail

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      key="${line%%=*}"
      value="${line#*=}"
      if [ -z "${!key+x}" ]; then
        export "$key=$value"
      fi
    fi
  done < .env
fi

STEP_DEPLOY_ENV="${STEP_DEPLOY_ENV:-production}"

is_local_or_private_url() {
  local value="$1"
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"localhost"* ]] && return 0
  [[ "$lower" == *"127.0.0.1"* ]] && return 0
  [[ "$lower" == *"[::1]"* ]] && return 0
  [[ "$lower" =~ ^https?://10\. ]] && return 0
  [[ "$lower" =~ ^https?://192\.168\. ]] && return 0
  [[ "$lower" =~ ^https?://172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
  [[ "$lower" =~ ^https?://0\.0\.0\.0 ]] && return 0
  return 1
}

require_public_or_same_origin() {
  local name="$1"
  local value="${2:-}"
  if [ -z "$value" ]; then
    return 0
  fi
  if [[ "$value" == /api* ]]; then
    return 0
  fi
  if ! [[ "$value" =~ ^https:// ]]; then
    echo "Invalid production endpoint: $name=$value"
    echo "Use same-origin /api routes, a public HTTPS URL, or set STEP_DEPLOY_ENV=local for local-only development."
    exit 1
  fi
  if is_local_or_private_url "$value"; then
    echo "Invalid production endpoint: $name=$value"
    echo "Production Worker deployments must not point to localhost, loopback, or private LAN backends."
    exit 1
  fi
}

if [ "$STEP_DEPLOY_ENV" != "local" ]; then
  require_public_or_same_origin STEP_BACKEND_GATEWAY_URL "${STEP_BACKEND_GATEWAY_URL:-}"
  require_public_or_same_origin STEP_BACKEND_INDEXER_URL "${STEP_BACKEND_INDEXER_URL:-}"
  require_public_or_same_origin STEP_BACKEND_FLEET_URL "${STEP_BACKEND_FLEET_URL:-}"
  require_public_or_same_origin STEP_PEER_DIRECTORY_URL "${STEP_PEER_DIRECTORY_URL:-}"
fi

if [ -z "${STEP_BACKEND_GATEWAY_URL:-}" ] && [ -z "${STEP_PEER_DIRECTORY_URL:-}" ] && [ -z "${STEP_PEERS_JSON:-}" ]; then
  echo "Missing public routing configuration. Provide at least one:"
  echo "- STEP_PEER_DIRECTORY_URL=https://..."
  echo "- STEP_PEERS_JSON='[{...}]'"
  echo "- STEP_BACKEND_GATEWAY_URL=https://... (temporary public bootstrap only)"
  exit 1
fi

export STEP_DEPLOY_ENV
export STEP_BACKEND_GATEWAY_URL="${STEP_BACKEND_GATEWAY_URL:-}"
export STEP_BACKEND_INDEXER_URL="${STEP_BACKEND_INDEXER_URL:-}"
export STEP_BACKEND_FLEET_URL="${STEP_BACKEND_FLEET_URL:-}"
export STEP_PEER_DIRECTORY_URL="${STEP_PEER_DIRECTORY_URL:-}"
export STEP_PEERS_JSON="${STEP_PEERS_JSON:-}"
export STEP_API_MODE="${STEP_API_MODE:-edge}"

if [ -z "${STEP_WEB_EXPLORER_URL:-}" ]; then export STEP_WEB_EXPLORER_URL="/explorer"; fi
if [ -z "${STEP_WEB_MINER_URL:-}" ]; then export STEP_WEB_MINER_URL="/miner"; fi

echo "Using Cloudflare deployment target account ${CLOUDFLARE_ACCOUNT_ID:+(account set)}"
echo "Cloudflare STEP public routing config:"
echo "  deploy env: ${STEP_DEPLOY_ENV}"
echo "  api mode: ${STEP_API_MODE}"
echo "  peer directory: ${STEP_PEER_DIRECTORY_URL:-<unset>}"
echo "  static peer records: ${STEP_PEERS_JSON:+set}"
echo "  bootstrap gateway: ${STEP_BACKEND_GATEWAY_URL:-<unset>}"
echo "  bootstrap indexer: ${STEP_BACKEND_INDEXER_URL:-<unset>}"
echo "  bootstrap fleet: ${STEP_BACKEND_FLEET_URL:-<unset>}"
echo "  explorer: ${STEP_WEB_EXPLORER_URL}"
echo "  miner: ${STEP_WEB_MINER_URL}"

echo "Deploying worker..."
pnpm --dir apps/static-frontend deploy:cloudflare-worker

echo "Deployment done."
