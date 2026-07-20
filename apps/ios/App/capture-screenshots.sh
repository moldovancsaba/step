#!/bin/zsh
# App Store screenshot capture (#33), fastlane-free. Drives the ScreenshotUITests
# XCUITest on the two required devices and extracts the named PNG attachments to
# fastlane/screenshots/en-US/ (deliver-compatible; device inferred from size).
#
# Notes on the flags (learned the hard way):
#   ARCHS=arm64                          this is an Apple-silicon host; the app
#                                        target otherwise builds x86_64 while SPM
#                                        packages build arm64 -> link failure.
#   SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG   the project doesn't define DEBUG by
#                                        default, so the -uiTestSeedWallet seam in
#                                        AppComposition (which bypasses the login
#                                        wall) is compiled out without this.
#   CODE_SIGNING_ALLOWED=NO              simulator run needs no signing.
set -eu
cd "$(dirname "$0")"
OUT=fastlane/screenshots/en-US
mkdir -p "$OUT"

capture() {  # <device-name> <prefix>
  local device="$1" prefix="$2"
  local xcresult="build/shots-${prefix}.xcresult"
  rm -rf "$xcresult"
  echo "==> $device"
  xcodebuild test -project StepApp.xcodeproj -scheme StepApp \
    -destination "platform=iOS Simulator,name=${device}" \
    -only-testing:StepAppUITests/ScreenshotUITests \
    -resultBundlePath "$xcresult" \
    -disableAutomaticPackageResolution ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" >/dev/null
  local tmp="build/shots-${prefix}"
  rm -rf "$tmp"
  xcrun xcresulttool export attachments --path "$xcresult" --output-path "$tmp" >/dev/null
  python3 - "$tmp" "$OUT" "$prefix" <<'PY'
import json, os, shutil, sys
tmp, out, prefix = sys.argv[1:4]
for e in json.load(open(os.path.join(tmp, "manifest.json"))):
    for a in e.get("attachments", []):
        nm = a.get("suggestedHumanReadableName", "")
        if nm[:2].isdigit() and "-" in nm:
            shutil.copyfile(os.path.join(tmp, a["exportedFileName"]),
                            os.path.join(out, f"{prefix}-{nm.split('_')[0]}.png"))
PY
  rm -rf "$xcresult" "$tmp"
}

capture "iPhone 17 Pro Max"      "iPhone-6.9"
capture "iPad Pro 13-inch (M5)"  "iPad-13"
echo "==> screenshots in $OUT:"
ls "$OUT"
