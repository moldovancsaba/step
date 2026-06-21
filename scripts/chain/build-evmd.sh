#!/bin/sh
# Build the STEP sovereign chain binary: cosmos/evm's `evmd` — CometBFT (BFT
# consensus) + full EVM, so the STEP Solidity contracts run unchanged on a
# self-hosted, decentralizable chain (ADR-024). No third-party chain, no DNS.
#
#   sh scripts/chain/build-evmd.sh        # → ~/.local/bin/evmd
set -eu

EVM_REF="${EVM_REF:-v0.7.0}"
PREFIX="${PREFIX:-$HOME/.local}"
WORK="${WORK:-/tmp/step-evmd-build}"

# Go toolchain (fetched locally if absent — no system package manager needed).
if ! command -v go >/dev/null 2>&1 && [ ! -x "$PREFIX/go/bin/go" ]; then
  GOVER=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1)
  OS=$(uname -s | tr '[:upper:]' '[:lower:]'); ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
  echo "[build] fetching $GOVER for $OS-$ARCH"
  curl -fsSL "https://go.dev/dl/${GOVER}.${OS}-${ARCH}.tar.gz" -o /tmp/go.tar.gz
  rm -rf "$PREFIX/go"; mkdir -p "$PREFIX"; tar -xzf /tmp/go.tar.gz -C "$PREFIX"
fi
GO="$(command -v go 2>/dev/null || echo "$PREFIX/go/bin/go")"

mkdir -p "$WORK"
[ -d "$WORK/evm/.git" ] || git clone --depth 1 --branch "$EVM_REF" https://github.com/cosmos/evm.git "$WORK/evm"
echo "[build] compiling evmd (cosmos/evm $EVM_REF) — a few minutes…"
( cd "$WORK/evm/evmd" && GOFLAGS=-mod=mod "$GO" build -o "$PREFIX/bin/evmd" ./cmd/evmd )
chmod +x "$PREFIX/bin/evmd"
echo "[build] ✓ $PREFIX/bin/evmd"
"$PREFIX/bin/evmd" version 2>/dev/null || true
