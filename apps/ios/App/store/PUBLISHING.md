# STEP iOS — App Store publishing runbook

Everything needed to take the STEP app from this repo to App Store review, in
order. Items marked **[you]** need an Apple Developer account, a real device, or
legal sign-off that can't be done from the build machine; everything else is
already in the repo.

## 0. What's already in the repo

| Artifact | Location |
|---|---|
| App target (reproducible XcodeGen project) | `apps/ios/App/project.yml` + `Sources/` |
| App icon (1024², opaque) + source renderer | `Assets.xcassets/AppIcon.appiconset/` · `tools/icon/RenderIcon.swift` |
| Usage strings + export-compliance flag | `Info.plist` |
| Entitlements (App Attest, NFC) | `StepApp.entitlements` |
| Privacy manifest | `PrivacyInfo.xcprivacy` |
| App Store listing text (fastlane deliver) | `fastlane/metadata/` |
| Screenshot spec + capture test | `store/screenshots/` |
| App Privacy answers | `store/app-privacy-details.md` |
| Export compliance | `store/export-compliance.md` |
| Privacy Policy + Terms (GTC) | `docs/legal/STEP_privacy_policy.md` · `docs/legal/STEP_terms_of_service.md` |
| fastlane lanes (build/beta/release/screenshots) | `fastlane/` |

## 1. Fill in the placeholders **[you]**

- Legal docs: replace `[LEGAL ENTITY]`, `[JURISDICTION]`, `[VENUE]`, addresses,
  liability cap, and contact emails in `docs/legal/*`. **Get them reviewed by
  counsel.**
- `fastlane/metadata/copyright.txt` and `review_information/phone_number.txt`.
- Decide the App Store **category** (currently Navigation / Lifestyle).

## 2. Host the legal pages **[you]**

The Privacy Policy URL is required by App Store Connect and must be public.
Publish `STEP_privacy_policy.md` (and Terms) as HTML — e.g. add `/privacy` and
`/terms` routes to the existing `step.moldovancsaba.workers.dev` site or GitHub
Pages — and make sure `fastlane/metadata/en-US/privacy_url.txt` points to it.

## 3. Apple Developer setup **[you]**

- Enrol in the Apple Developer Program; create the App ID `app.step.miner` with
  **App Attest** and **NFC Tag Reading** capabilities.
- Register the app in App Store Connect (name "STEP — Proof of Presence").
- Create signing assets (recommended: `fastlane match` for a shared cert/profile)
  and set `DEVELOPMENT_TEAM` (locally or as a CI secret).
- For the Release config, flip the App Attest entitlement environment from
  `development` to `production` in `StepApp.entitlements`.

## 4. Configure endpoints

Set the production endpoint build settings (an `.xcconfig` per configuration):
`STEP_GATEWAY_URL`, `STEP_MESH_URL`, `STEP_INDEXER_URL`, `STEP_ACCOUNT_URL`,
`STEP_NFT_INDEXER_URL`, and for marketplace trading `STEP_RPC_URL`,
`STEP_MARKETPLACE_ADDRESS`, `STEP_NFT_ADDRESS`, `STEP_TRINITY_ADDRESS` (the last
four land with the #5 deploy). These flow into `Info.plist → AppConfig`.

## 5. Generate, build, and self-check

```sh
brew install xcodegen fastlane
cd apps/ios/App
xcodegen generate
# Smoke build (CI also does this on a generic simulator):
xcodebuild build -project StepApp.xcodeproj -scheme StepApp \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
```

Ship-gate checks before archiving:

- [ ] **Accessibility:** full-app VoiceOver pass, Dynamic Type to accessibility
      sizes without clipping, contrast in light + dark, Reduce Motion. (XCUITests
      cover the automatable slice.)
- [ ] **Performance:** cold launch < 1s to first frame; no main-thread hangs
      (Instruments).
- [ ] **Permissions:** each usage-string path works and degrades gracefully when
      denied; App Attest degrades to "unattested" on Simulator.
- [ ] **Devices:** smallest/largest iPhone; iPad layout if shipping iPad.

## 6. Screenshots

See `store/screenshots/README.md`. With the snapshot test enabled:
`fastlane ios screenshots`.

## 7. TestFlight **[you]**

```sh
fastlane ios beta            # archives + uploads to TestFlight
```

Add internal testers; verify mining, map, wallet, and (when deployed) the
marketplace on a real device. Staged rollout before public review.

## 8. Submit to review **[you]**

```sh
fastlane ios release        # uploads build + metadata + screenshots (submit_for_review:false)
```

Then in App Store Connect: complete **App Privacy** (`store/app-privacy-details.md`),
confirm **export compliance** (`store/export-compliance.md`), set the **age
rating** (17+), attach the **Privacy Policy URL**, paste the **review notes**
(already in `fastlane/metadata/review_information/notes.txt`), and submit.

## 9. Common review pitfalls for this app (pre-empt them)

- **Crypto/“financial” classification:** the review notes state plainly that
  Trinity is a **testnet token with no monetary value**, not an investment, and
  cannot be bought with money. Keep that messaging in the description and in-app.
- **Location justification:** make sure the "when in use" prompt and the privacy
  copy both say location is used only to find the current triangle and never
  leaves the device.
- **App Attest on Simulator:** reviewers may test on Simulator; the app must (and
  does) clearly show the "unattested" tier rather than failing.
- **Account walls:** an account is optional (local-wallet onboarding works
  without one); offer a demo account if asked.
