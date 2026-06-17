# StepApp — iOS app target (#33)

The shippable iOS app that wraps the `StepAppUI` SPM product into an installable,
attestable, distributable app. The project is **reproducible**: it is defined by
the checked-in [`project.yml`](project.yml) (XcodeGen) rather than a hand-edited
`.pbxproj`, so diffs stay reviewable and CI is deterministic.

## Generate + run

```sh
brew install xcodegen          # one-time
cd apps/ios/App
xcodegen generate              # → StepApp.xcodeproj
open StepApp.xcodeproj          # run on a simulator or device
```

CI (`.github/workflows/ci.yml`, job `ios-app`) generates the project and builds
the app + UI-test bundle for a generic iOS Simulator destination on every push.

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
`STEP_NFT_INDEXER_URL`, and for marketplace trading `STEP_RPC_URL`,
`STEP_MARKETPLACE_ADDRESS`, `STEP_NFT_ADDRESS`, `STEP_TRINITY_ADDRESS`). Provide
an `.xcconfig` per environment (Debug/pilot/Release). Marketplace trading is
enabled only when the RPC URL and all three addresses are set; otherwise the
Marketplace tab browses and states that trading isn't available yet.

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
