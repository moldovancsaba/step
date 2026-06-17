# STEP iOS miner app

**Status: protocol core + product surface (auth, mining, oasis/desert map, wallet/NFTs, device attestation) implemented and test-verified as a Swift package; the Xcode app target + TestFlight pipeline are the remaining packaging steps (documented honestly below — no hidden gaps).**

All UI is built natively with SwiftUI against a GDS-parity design system (`StepAppUI/Theme.swift` mirrors the @doneisbetter/gds tokens used by the web apps, because GDS is React/Mantine and cannot run on iOS). Accessibility (Dynamic Type, VoiceOver labels, colour-independent state, Reduce Motion) is treated as mandatory, not optional.

## What exists and is verified

`StepCore/` is a Swift package built on CI via `swift build` (cross-platform) and `swift test` (macOS + Xcode toolchain — the `Testing` framework is unavailable under bare Command Line Tools, so locally only `swift build` verifies; the swift CI job runs the full test suite).

### StepCore (protocol + transport, UI-free)

| Module | Contents | Verification |
|---|---|---|
| `Keccak` | Pure-Swift Keccak-256 (Ethereum variant) | NIST/Ethereum vectors |
| `CanonicalClaim` | `step.proof.location.v1` claim + STEP-CLAIM-V1 canonical message + claim/triangle hashes + EIP-191 digest | **Byte-identical to Rust**: replays `packages/schemas/cross-language-vector.v1.json` |
| `Wallet` | secp256k1 wallet (secp256k1.swift 0.15.0), Ethereum address, 65-byte r‖s‖v signing, Keychain + in-memory key stores | **Reproduces the Rust k256 signature byte-for-byte** (RFC-6979) |
| `ClaimBuilder` | Location + nonce + integrity evidence → signed claim; `makeClaim` (explicit evidence) and `makeAttestedClaim` (evidence from an `Attesting` provider, bound to the core claim hash) | Unit tests |
| `Attestation` (#31) | `Attesting` protocol, `UnattestedAttester` fallback (all platforms), `AppAttestAttester` (iOS-only, `DCAppAttestService`) | `AttestationTests` (fallback, wire-mapping, hash-binding) |
| `MineableResolver` (#26) | v2 genesis→breakdown walk: resolves the current mineable triangle (level 1→21) from indexer state; `.desert`/`.frozen` errors | Unit tests |
| `IndexerClient` (#26) | `TriangleStateProviding` via `GET /v1/mesh-states/{idHash}` | Unit tests |
| `AccountVault` (#27) | Argon2id KDF + AES-256-GCM zero-knowledge wallet vault; **cross-impl parity** with the @noble/account-api vector | `AccountVaultTests` parity vector |
| `AccountClient` (#27) | register/login/logout/session/updateVault against account-api (cookie session) | Unit tests |
| `NftClient` (#29) | Owned slot NFTs via `GET /v1/owners/{address}`; landlord (slot 0) + mining-order derivation | Unit tests |
| `MeshCoverClient` (#28) | Stitches validator `/v1/mesh/cover` (#15) + indexer mesh-states (#16) into coloured overlay triangles | `MeshCoverClientTests` |

### StepAppUI (SwiftUI, GDS-parity)

| Module | Contents |
|---|---|
| `Theme` (#25) | GDS-token colours (light/dark), green→red depletion ramp matching the web map, spacing/radius scales |
| `SessionContext` / `AsyncSurface` (#25) | Observable session + accessible load/empty/error/retry surface |
| `LoginWall` (#27) | GDS-parity sign-in / sign-up, secure fields, accessible validation |
| `AppModel` | `@MainActor` state machine: onboarding/login gate, register/sign-in (Argon2 off-main), mining (via `MineableResolver` + `attester`), owned NFTs, sign-out |
| `Views` | Themed 4-tab shell (Mine / Map / Wallet / Market), testnet banner, account menu, claim history, privacy settings |
| `MapView` (#28) | MapKit oasis/desert overlay — per-triangle depletion fill, debounced viewport fetch, legend, truncation/zoom hint |

Because every signed byte is identical across Swift, Rust, and TypeScript, a claim built by this code is accepted by the validator network and contracts proven in `tests/e2e` — the chain path needs no iOS-specific verification.

## Device attestation (#31, ADR-015)

`Attesting` produces the `AttestationEvidence` that `ClaimBuilder.makeAttestedClaim` binds to the claim's **core hash** (the keccak of the unattested claim) before the wallet signs, so the single signature still covers the final attested claim and the server can recompute the bound hash to verify the assertion.

- `AppAttestAttester` (iOS-only, compiled under `#if os(iOS)`): generates a hardware-backed App Attest key once, attests it (the attestation object is registered server-side — paired backend issue), then produces a per-claim assertion over the claim hash. Wire mapping: `appAttestation` = base64 assertion, `deviceIntegrity` = attested key id.
- `UnattestedAttester` (all platforms, the default): always returns the clearly-marked `.devUnattested` tier — **never silently "attested"** on Simulator / unsupported devices / macOS.

App Attest is a device-only API: it cannot be exercised on the Simulator or on this Command-Line-Tools build machine, so its behaviour is verified by structure (compiled behind `#if os(iOS)`, fallback covered by tests) and must be field-verified on a physical device. Pilot validators reject `attested` claims until server-side verification of Apple attestation objects ships (`allow_dev_claims=false`) — by design, never silently downgraded.

## What is NOT done yet (requires Xcode / Apple accounts — the build machine has Command Line Tools only)

1. **Xcode app target (#33).** Create the iOS App target, add the local `StepCore` package, set `RootView(model:)` as the root. Required Info.plist usage strings + App Attest entitlement — see `apps/ios/StepMiner/` scaffold and `docs/engineering/STEP_ios_app_plan.md`.
2. **Server-side App Attest verification.** Gateway/validator must verify Apple attestation objects + assertions before accepting `attested` claims (paired backend issue).
3. **MapLibre Native basemap.** The map renders the mesh overlay on MapKit; the full vector basemap (MapLibre Native iOS via SPM) is an app-target integration.
4. **TestFlight.** Apple Developer Program membership, signing, `xcodebuild archive` + upload; app-store crypto-rules review (LEG-003/IOS-008) before distribution.
5. **Field tests F1–F9** (`tests/field-tests/`) need physical iPhones in the pilot area.

## Running the core tests

```sh
cd apps/ios/StepCore
swift build   # cross-platform build (verifiable on Command Line Tools)
swift test    # full suite — requires the Xcode toolchain (Testing framework)
```
