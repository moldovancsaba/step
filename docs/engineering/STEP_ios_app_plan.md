# STEP iOS app — implementation plan

Apple-first native client. The protocol core already exists as a cross-platform
Swift package (`apps/ios/StepCore`, builds + tested on macOS in CI). This plan
takes it from "mining vertical slice" to feature parity with the v2 model and
the GDS web app, then to App Store readiness.

## Current state (done)

- `StepCore` package: `Wallet` (secp256k1, Keychain/Secure-Enclave KeyStore +
  in-memory for tests), `Keccak`, `CanonicalClaim` (STEP-CLAIM-V1, byte-identical
  to Rust/TS — conformance-tested), `ClaimBuilder`, `GatewayClient`
  (resolve/nonce/submit/status).
- `StepAppUI`: `AppModel` state machine (create/import wallet, `updateLocation`
  defaults to **genesis level 1**, `mine`), `LocationService` (CoreLocation),
  onboarding/mining `Views`.
- Conformance tests replay the shared golden/claim vectors. Library builds clean.

## Target architecture

```
StepCore (protocol, cross-platform, no UIKit)
  Wallet · Keccak · CanonicalClaim · ClaimBuilder · GatewayClient
  + AccountVault (NEW)  · MineableResolver (NEW) · MeshCoverClient (NEW)
  + NftClient (NEW)     · Attestation (NEW)      · AnchorCapture (NEW)
StepAppUI (SwiftUI)
  AppShell (tabs: Mine · Map · Wallet · Marketplace) · LoginWall · MapView …
```

All new logic lands in `StepCore` (pure, macOS-testable) with thin `StepAppUI`
views on top — same split that already keeps CI green without a simulator.

## Phases

### Phase 1 — v2 mining alignment (no new deps)
- **MineableResolver**: given a location, resolve the *current* mineable triangle
  by walking level 1 → 21 and taking the first whose triangle is not exhausted
  (mirrors the web app's `resolveMineableTriangle`; the contract gates deeper
  levels by parent-exhaustion). Needs a triangle-state lookup (used_slots/total,
  frozen) — add a small `TriangleStateProviding` protocol so it is transport-
  agnostic and unit-testable.
- Wire `AppModel.updateLocation`/`mine` to use it; surface the dotted v2 id +
  slot + oasis/desert state in the mining view.
- Tests: resolver picks level 1 on a virgin location, skips exhausted ancestors,
  stops at 21 (desert) — with a mock state provider.

### Phase 2 — Account & login wall (#12/#13 parity)
- **AccountVault**: zero-knowledge vault matching `account-api` exactly —
  Argon2id KDF → split authKey (sent) / wrapKey (local), AES-256-GCM encrypt of
  the wallet key, register/login/session/vault. AES-GCM + HKDF via CryptoKit;
  **Argon2id needs one dependency** (CryptoKit lacks it) — propose
  `swift-sodium` or a small audited Argon2 SPM package (justify per the no-
  unwanted-deps rule; pick the smallest audited one).
- **LoginWall** view (email/username + password); session held in memory, key
  decrypted into the existing `KeyStore`. Keep generate/import as recovery.
- Tests: client KDF + AES-GCM round-trip decrypts to the same address as the
  account-api crypto round-trip (cross-impl parity vector).

### Phase 3 — Oasis/desert map (#15/#16/#17 parity)
- **MeshCoverClient**: call validator `/v1/mesh/cover` + indexer
  `/v1/mesh-states` for the viewport.
- **MapView** on **MapKit** (native, no extra dep) with a triangle overlay
  coloured green→red by depletion (~30% opacity); "zoom in" on truncation.
- Tests: cover→states stitching, colour mapping.

### Phase 4 — NFT wallet + marketplace (#6/#7/#10/#11 parity)
- **NftClient**: owned slot NFTs + provenance from `nft-indexer`.
- Wallet tab lists owned triangles (landlord badge for slot 0); marketplace
  browse/list/buy/gift (testnet) once the marketplace is deployed.

### Phase 5 — Proof hardening (#19/#20/#21)
- **Attestation**: real **App Attest** (DeviceCheck) assertion in the claim
  (replaces the current `AttestationEvidence` stub).
- **AnchorCapture**: BLE/NFC trusted-anchor proofs against `AnchorRegistry`
  (#18) — CoreBluetooth / CoreNFC.
- Multi-signal fusion fields wired into the claim/evidence bundle.

### Phase 6 — App Store readiness
- Xcode app target wrapping `StepAppUI`, Info.plist usage strings (location,
  Bluetooth, NFC), App Attest entitlement, privacy nutrition labels (no raw GPS
  off-device — PRV-001), TestFlight, screenshots, review notes (testnet/no
  monetary value).

## Constraints (per CLAUDE.md)
- No coordinates leave the device unencrypted (PRV-001); only triangle id +
  proof hash go on-chain.
- Cross-language parity: `CanonicalClaim`/ids stay byte-identical to Rust/TS
  (golden + claim vectors). IDs are Mesh ID v2 (dotted) — treated as opaque
  strings on device (hash only), so no parser needed.
- Every new module: macOS-testable, zero warnings, justified dependencies.

## Verification gate (before each commit)
`swift build` (clean) + `swift test` under Xcode's toolchain (CI swift job:
macos-15 + latest Xcode). New tests prefer the repo's `Testing` style.
