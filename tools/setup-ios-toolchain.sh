#!/usr/bin/env bash
# Sets up the local iOS toolchain for the STEP app (#33).
#
# Tiered by privilege so it does as much as possible without admin:
#   * XcodeGen        — installed user-locally, NO admin needed. Lets you run
#                       `xcodegen generate` to produce StepApp.xcodeproj.
#   * Homebrew        — needs admin (sudo) once; used for fastlane + xcodes.
#   * Full Xcode      — needs admin AND an Apple ID; required for xcodebuild,
#                       the iOS simulators, archiving, and TestFlight.
#
# Run:   bash tools/setup-ios-toolchain.sh           # does the no-admin parts
#        bash tools/setup-ios-toolchain.sh --full     # also drives brew + xcodes
#
# Idempotent: safe to re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_BIN="$HOME/.local/bin"
LOCAL_OPT="$HOME/.local/opt"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1

info() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }

mkdir -p "$LOCAL_BIN" "$LOCAL_OPT"

# --- 1. XcodeGen (no admin) -------------------------------------------------
if command -v xcodegen >/dev/null 2>&1 || [ -x "$LOCAL_BIN/xcodegen" ]; then
  info "XcodeGen already installed: $(xcodegen --version 2>/dev/null || "$LOCAL_BIN/xcodegen" --version)"
else
  info "Installing XcodeGen (user-local, no admin)…"
  api="$(curl -fsSL https://api.github.com/repos/yonaskolb/XcodeGen/releases/latest)"
  url="$(printf '%s' "$api" | grep -m1 'browser_download_url.*xcodegen.zip' | sed -E 's/.*"(https[^"]+)".*/\1/')"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/xcodegen.zip" "$url"
  rm -rf "$LOCAL_OPT/xcodegen"
  mkdir -p "$LOCAL_OPT/xcodegen"
  unzip -q "$tmp/xcodegen.zip" -d "$LOCAL_OPT/xcodegen"
  xattr -dr com.apple.quarantine "$LOCAL_OPT/xcodegen" 2>/dev/null || true
  ln -sf "$LOCAL_OPT/xcodegen/xcodegen/bin/xcodegen" "$LOCAL_BIN/xcodegen"
  info "XcodeGen $("$LOCAL_BIN/xcodegen" --version) installed to $LOCAL_BIN/xcodegen"
fi

case ":$PATH:" in
  *":$LOCAL_BIN:"*) ;;
  *) warn "Add \$HOME/.local/bin to PATH:  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
esac

# --- 2. Generate + validate the project (no admin) --------------------------
info "Generating StepApp.xcodeproj from the spec…"
( cd "$REPO_ROOT/apps/ios/App" && "$LOCAL_BIN/xcodegen" generate --spec project.yml >/dev/null )
plutil -lint "$REPO_ROOT/apps/ios/App/StepApp.xcodeproj/project.pbxproj"
info "Project generated and pbxproj lints OK."

# --- 3. Library checks you CAN run without Xcode ----------------------------
info "Building the StepCore SwiftPM package (CLT is enough)…"
( cd "$REPO_ROOT/apps/ios/StepCore" && swift build >/dev/null && echo "  swift build: OK" )
warn "swift test needs the full Xcode toolchain (Testing framework) — runs on CI."

# --- 4. Admin-only tiers ----------------------------------------------------
if [ "$FULL" -eq 0 ]; then
  cat <<EOF

Done with the no-admin setup. To build/run the app you still need the full
Xcode toolchain (admin + Apple ID required):

  1. Install Homebrew (one-time, asks for your password):
       /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  2. Install Xcode. Easiest via the App Store, or scripted with xcodes:
       brew install xcodesorg/made/xcodes
       xcodes install --latest            # signs in to your Apple ID, ~12 GB
       sudo xcode-select -s /Applications/Xcode.app
       sudo xcodebuild -license accept

  3. Install fastlane (for screenshots / TestFlight / submit):
       brew install fastlane

  4. Build the app:
       cd apps/ios/App && xcodebuild build -scheme StepApp \\
         -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO

Re-run with --full once Homebrew is available to install xcodes + fastlane.
EOF
  exit 0
fi

# --full: requires Homebrew already present (it needs admin to install itself).
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. Install it first (needs your password):"
  warn '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
info "Installing xcodes + fastlane via Homebrew…"
brew install xcodesorg/made/xcodes fastlane || true
cat <<EOF

Next (interactive, your Apple ID + password):
  xcodes install --latest
  sudo xcode-select -s /Applications/Xcode.app
  sudo xcodebuild -license accept
EOF
