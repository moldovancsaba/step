# STEP iOS miner app

**Status: protocol core complete and test-verified; app shell compiles; Xcode app target + TestFlight pipeline are the remaining steps (documented below — no hidden gaps).**

## What exists and is verified

`StepCore/` is a Swift package, built and tested on this repo's CI machine via `swift build` / `swift test` (8/8 tests passing):

| Module | Contents | Verification |
|---|---|---|
| `StepCore/Keccak` | Pure-Swift Keccak-256 (Ethereum variant) | NIST/Ethereum vectors |
| `StepCore/CanonicalClaim` | `step.proof.location.v1` claim + STEP-CLAIM-V1 canonical message + claim/triangle hashes + EIP-191 digest | **Byte-identical to Rust**: replays `packages/schemas/cross-language-vector.v1.json` |
| `StepCore/Wallet` | secp256k1 wallet (GigaBitcoin/secp256k1.swift 0.15.0), Ethereum address derivation, 65-byte r‖s‖v signing, `KeychainKeyStore` (WhenUnlocked, ThisDeviceOnly) + `InMemoryKeyStore` | **Reproduces the Rust k256 signature byte-for-byte** (RFC-6979 determinism) |
| `StepCore/ClaimBuilder` | Location sample + nonce + integrity evidence → signed claim; explicit `attested` / `dev-unattested` modes (ADR-015, never silently upgraded) | Unit tests |
| `StepCore/GatewayClient` | Nonce, claim submission, claim status, canonical mesh resolution (URLSession async) | Exercised against the same API shapes the E2E suite proves end-to-end |
| `StepAppUI` | SwiftUI screens: onboarding (flow A), mine screen with native triangle rendering (flow B), claim history, wallet, privacy settings (private-by-default, HARD §13.4); `AppModel` state machine; `LocationService` (Core Location one-shot fixes, no background tracking) | Compiles via `swift build` (cross-platform targets) |

Because every signed byte is identical across Swift, Rust, and TypeScript, a claim built by this code is accepted by the validator network and contracts proven in `tests/e2e` — the chain path needs no iOS-specific verification.

## What is NOT done yet (requires Xcode / Apple accounts — unavailable on the build machine, which has Command Line Tools only)

1. **Xcode app target.** Create an iOS App project `StepMiner` in Xcode, add the local `StepCore` package, set `RootView(model:)` as the root view. Required Info.plist keys: `NSLocationWhenInUseUsageDescription` (text must match the onboarding privacy promise).
2. **App Attest / DeviceCheck (IOS requirement, ADR-015).** Implement `DCAppAttestService` enrolment and per-claim assertions in the app target (entitlement required), feed them to `ClaimBuilder` as `.attested(...)`. Server-side verification of Apple's attestation objects must be added to the gateway/validator before pilot claims are accepted as `attested` — until then pilot validators reject app claims by design (`allow_dev_claims=false`).
3. **MapLibre Native basemap.** The mine screen renders the canonical triangle natively; the full MESH basemap (MapLibre Native iOS via SPM) is an app-target integration. Until then the explorer web map is the visual MESH reference.
4. **TestFlight.** Apple Developer Program membership, signing, `xcodebuild archive` + upload. Gate: app-store crypto-rules review (LEG-003/IOS-008) before any distribution.
5. **Field tests F1–F9** (`tests/field-tests/`) need physical iPhones in the pilot area.

## Running the core tests

```sh
cd apps/ios/StepCore
swift test   # 8 tests: keccak vectors, Rust-conformance (message/hashes/signature), claim builder, wallet round-trip
```
