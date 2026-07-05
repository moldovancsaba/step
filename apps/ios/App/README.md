# StepApp — iOS app target (#33)

The shippable iOS app that wraps the `StepAppUI` SPM product into an installable,
attestable, distributable app. The project is **reproducible**: it is defined by
the checked-in [`project.yml`](project.yml) (XcodeGen) rather than a hand-edited
`.pbxproj`, so diffs stay reviewable and CI is deterministic.

## Generate + run

One-command toolchain setup (installs XcodeGen user-locally with **no admin**,
generates the project, and builds the StepCore package):

```sh
bash tools/setup-ios-toolchain.sh
```

Or manually:

```sh
brew install xcodegen          # or: tools/setup-ios-toolchain.sh installs it without admin
cd apps/ios/App
xcodegen generate              # → StepApp.xcodeproj (gitignored — regenerate any time)
open StepApp.xcodeproj          # run on a simulator or device
```

The `.xcodeproj` is **generated from `project.yml` and gitignored** — never edit
it by hand; change `project.yml` and regenerate.

> ⚠️ **`project.yml` references `Info.plist` and `StepApp.entitlements` via build
> settings (`INFOPLIST_FILE` / `CODE_SIGN_ENTITLEMENTS`), not via XcodeGen's
> `info:` / `entitlements:` keys.** Those keys make XcodeGen *generate* (and
> overwrite) the files, which would wipe the usage strings and App Attest/NFC
> entitlements. Keep them as build settings.

### Toolchain privilege tiers

| Tier | Needs | Enables |
|---|---|---|
| XcodeGen (user-local) | nothing | `xcodegen generate`, validate the project |
| StepCore `swift build` | Command Line Tools | compile/verify the library |
| Full Xcode + simulators | admin + Apple ID (~12 GB) | `xcodebuild`, `swift test`, run/archive |
| fastlane | Homebrew | screenshots, TestFlight, submit |

`tools/setup-ios-toolchain.sh` does the no-admin tiers automatically and prints
the exact admin/Apple-ID commands for the rest (`--full` drives brew + xcodes).

CI (`.github/workflows/ci.yml`, job `ios-app`) generates the project and builds
the app + UI-test bundle for a generic iOS Simulator destination on every push
(GitHub's macOS runners ship the full Xcode).

## What's in here

| File | Purpose |
|---|---|
| `project.yml` | XcodeGen spec: `StepApp` (app) + `StepAppUITests` (XCUITest), depends on the local `StepCore` package's `StepAppUI` product, iOS 17 min. |
| `Sources/StepApp.swift` | `@main` composition root — builds the StepCore clients + `AppModel` from `AppConfig` and shows `RootView`. App Attest on device, unattested on Simulator (#31). |
| `Sources/Metrics.swift` | PII-free MetricKit + os_log observability hook (#33 §14). |
| `Info.plist` | Usage strings (location / Bluetooth / NFC / camera) + `StepConfig` endpoint dictionary (overridable per build configuration). |
| `StepApp.entitlements` | App Attest environment (#31) + CoreNFC NDEF (#32). |
| `PrivacyInfo.xcprivacy` | Privacy manifest (PRV-001): no tracking, precise location used on-device only, required-reason APIs declared. |
| `Tests/StepAppUITests.swift` | Cold-launch + accessibility smoke checks (foundation of the VoiceOver ship gate). |

## Configuration

No URLs or secrets are hard-coded in source. `AppConfig` reads the `StepConfig`
dictionary from `Info.plist`, whose values come from build settings
(`STEP_GATEWAY_URL`, `STEP_MESH_URL`, `STEP_INDEXER_URL`, `STEP_ACCOUNT_URL`,
`STEP_NFT_INDEXER_URL`, `STEP_WEB_APP_URL`, and for marketplace trading `STEP_RPC_URL`,
`STEP_MARKETPLACE_ADDRESS`, `STEP_NFT_ADDRESS`, `STEP_TRINITY_ADDRESS`). Provide
an `.xcconfig` per environment (Debug/pilot/Release). Marketplace trading is
enabled only when the RPC URL and all three addresses are set; otherwise the
Marketplace tab browses and states that trading isn't available yet.

`STEP_WEB_APP_URL` should point at the canonical map-only globe surface:

```text
https://step.moldovancsaba.workers.dev/?surface=ios-map
```

That surface renders the same MapLibre GL JS v5 globe and `step-globe-mesh-custom`
layer used by the public web app.

## Store assets & legal (ready in-repo)

Everything needed to submit is checked in — see **[`store/PUBLISHING.md`](store/PUBLISHING.md)**
for the end-to-end runbook. Key pieces:

| Asset | Location |
|---|---|
| App icon (1024², opaque) + reproducible renderer | `Assets.xcassets/AppIcon.appiconset/` · [`../../../tools/icon/RenderIcon.swift`](../../../tools/icon/RenderIcon.swift) |
| App Store listing text (name/subtitle/description/keywords/promo/review notes) | [`fastlane/metadata/`](fastlane/metadata) |
| Screenshot spec + capture test | [`store/screenshots/`](store/screenshots) |
| App Privacy "nutrition label" answers | [`store/app-privacy-details.md`](store/app-privacy-details.md) |
| Export-compliance note | [`store/export-compliance.md`](store/export-compliance.md) |
| Privacy Policy | [`../../../docs/legal/STEP_privacy_policy.md`](../../../docs/legal/STEP_privacy_policy.md) |
| Terms of Service (GTC) | [`../../../docs/legal/STEP_terms_of_service.md`](../../../docs/legal/STEP_terms_of_service.md) |
| fastlane lanes (build / beta / release / screenshots) | [`fastlane/Fastfile`](fastlane/Fastfile) |

The legal documents and a few listing fields contain clearly-marked
`[PLACEHOLDER]`s (legal entity, jurisdiction, contact, category) that need your
input + counsel review before submission — `store/PUBLISHING.md` lists them.

## App Store / TestFlight readiness

- **Signing:** set `DEVELOPMENT_TEAM` (locally or via CI secret) and flip the
  App Attest entitlement to `production` in the Release configuration.
- **Review notes (draft):**
  - This is a **testnet** build of a proof-of-presence protocol. The in-app
    token, **Trinity, has no monetary value** and cannot be bought with money.
  - **Location** is used only to determine which fixed MESH triangle the device
    is in. Precise coordinates never leave the device; only a triangle id and a
    proof hash are submitted (see `PrivacyInfo.xcprivacy`).
  - **App Attest** is used to prove the app runs on genuine hardware; on the
    Simulator the app clearly degrades to an "unattested" tier.
  - Optional **Bluetooth / NFC / camera** are used only to read trusted
    "anchor" tags/beacons/QRs the user deliberately taps to verify presence.
- **Accessibility ship gate:** a full-app VoiceOver + Dynamic Type + contrast
  pass (light/dark) is required before submission; the XCUITests cover the
  automatable slice (labels present, launch reachable).
- **Performance:** verify cold launch < 1s to first frame and no main-thread
  hangs with Instruments before submission.

## Why some things are verified only on-device

App Attest, CoreNFC, and the camera are device-only APIs unavailable on the
Simulator and on the Command-Line-Tools build machine used for `swift build`.
They are compiled behind `#if` guards in `StepAppUI` and must be field-verified
on a physical iPhone (iOS 17+). The marketplace on-chain round-trip is verified
once contracts are deployed (#5); its encoding/signing is unit-tested against
`cast` vectors today.
