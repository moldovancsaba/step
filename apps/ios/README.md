# STEP iOS miner app

## System role

The iOS app now has a **choosable launcher** after wallet/login:

- **Mine & explore**: normal user mode for visiting triangles, signing
  proof-of-location claims, managing the wallet, viewing the mesh, and trading.
- **Mobile Trust Center**: foreground iPhone/iPad mode for users who keep a
  device powered, awake, connected, and running STEP continuously. This mode is
  designed to support future mobile trust-center enrollment, vote signing,
  attested device contribution, and rewards that do **not** require the owner to
  visit new locations.

The Mobile Trust Center is a real trust-center class, but not the same class as
a full macOS/Linux Trust Center. iOS/iPadOS can hold the wallet identity, use
Secure Enclave/App Attest, sign future validator votes, and participate while
the app is alive. It cannot honestly guarantee boot-daemon startup, unattended
binary self-update, local chain RPC, public gateway/fleet APIs, or launchd-style
crash restart after the app is backgrounded, terminated, or the device reboots.

So the system has three roles:

- `mobile_peer`: normal miner/user app.
- `mobile_trust_center`: iPhone/iPad kept running as an attested trust device,
  eligible for future uptime/participation rewards.
- `full_trust_center`: macOS/Linux infrastructure node running agent,
  validator, gossip, chain RPC, gateway, and fleet continuously.

**Status: protocol core + full product surface (auth, mining, oasis/desert map, wallet/NFTs, device attestation, trusted-anchor capture, marketplace) implemented and test-verified as a Swift package; a reproducible XcodeGen app target ([`App/`](App/)) packages it for the simulator/device/TestFlight. Device-only APIs (App Attest, NFC, camera) and the on-chain marketplace round-trip are field/deploy-verified — documented honestly below, no hidden gaps.**

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
| `Anchor` (#32) | `AnchorKind`/`AnchorProof`/`AnchorCapturing` wire types + `AnchorChallenge` (keccak256(abi.encode(miner,nonceHash,anchorId,window)), byte-identical to `AnchorRegistry.challenge`) | `AnchorTests` (window/nonceHash/abi-encode/codable/parity) |
| `Marketplace` (#30) | `Listing`/`Trade` + `MarketplaceClient` reads (nft-indexer #10) | `MarketplaceTests` (decode) |
| `Web3` (#30) | Dependency-free RLP, ABI calldata, EIP-1559 (type-2) tx signing, JSON-RPC client | `Web3Tests` (selectors/calldata/RLP/big-decimal/signing — vectors from `cast`) |
| `MarketplaceWriter` (#30) | Signed `list`/`cancel`/`buy`/`gift` (+ Trinity allowance / NFT approval) with simulate-before-send + decoded reverts | `MarketplaceTests` (revert mapping) |
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
| `AnchorCapture` / `AnchorReaders` (#32) | Accessible capture state machine + transport readers — `QRAnchorReader` (AVFoundation, iOS), `NFCAnchorReader` (CoreNFC, iOS), `BLEAnchorReader` (CoreBluetooth) — each behind `#if canImport(...)`; offers only the transports the device has |
| `MarketplaceView` (#30) | Browse active listings + my-listings filter, buy/cancel/gift/list with explicit price-showing confirmation, decoded-revert + paused + not-deployed states; GDS-parity, fully accessible |

Because every signed byte is identical across Swift, Rust, and TypeScript, a claim built by this code is accepted by the validator network and contracts proven in `tests/e2e` — the chain path needs no iOS-specific verification.

## Device attestation (#31, ADR-015)

`Attesting` produces the `AttestationEvidence` that `ClaimBuilder.makeAttestedClaim` binds to the claim's **core hash** (the keccak of the unattested claim) before the wallet signs, so the single signature still covers the final attested claim and the server can recompute the bound hash to verify the assertion.

- `AppAttestAttester` (iOS-only, compiled under `#if os(iOS)`): generates a hardware-backed App Attest key once, attests it (the attestation object is registered server-side — paired backend issue), then produces a per-claim assertion over the claim hash. Wire mapping: `appAttestation` = base64 assertion, `deviceIntegrity` = attested key id.
- `UnattestedAttester` (all platforms, the default): always returns the clearly-marked `.devUnattested` tier — **never silently "attested"** on Simulator / unsupported devices / macOS.

App Attest is a device-only API: it cannot be exercised on the Simulator or on this Command-Line-Tools build machine, so its behaviour is verified by structure (compiled behind `#if os(iOS)`, fallback covered by tests) and must be field-verified on a physical device. Pilot validators reject `attested` claims until server-side verification of Apple attestation objects ships (`allow_dev_claims=false`) — by design, never silently downgraded.

## Trusted-anchor capture (#32, AnchorRegistry #18)

An optional step in the mine flow: read a registered anchor (BLE beacon / NFC tag / rotating QR) to corroborate presence beyond GPS. The anchor signs `AnchorChallenge.hash(miner, nonceHash, anchorId, window)` (== `AnchorRegistry.challenge`); the app captures `{anchorId, proofWindow, signature}`, wraps it as an `AnchorProof`, and attaches it to the next claim as evidence for validator multi-signal fusion (#19) and on-chain `verifyAnchorProof`. The proof is bound to the miner + claim nonce and cleared after each submit, so it can never be replayed.

`StepCore` holds the transport-free wire types + challenge maths (macOS-buildable, fully tested); the radio/camera readers are iOS-device features. `BLEAnchorReader` (CoreBluetooth) compiles + builds on macOS; `QRAnchorReader` (AVFoundation) and `NFCAnchorReader` (CoreNFC) are iOS-only and must be field-verified on a device. Permissions (`NSBluetoothAlwaysUsageDescription`, NFC entitlement, `NSCameraUsageDescription`) are configured in the app target (#33).

## Marketplace (#30, TriangleMarketplace #8 + indexer #10)

Browse active listings and trade history (read path, fully testable). Trading —
`list` / `cancel` / `buy` / `gift` — is built on a small dependency-free web3
layer (`Web3.swift`: RLP, ABI calldata, EIP-1559 signing reusing the secp256k1
wallet, JSON-RPC). Every state-changing action **simulates first** (`eth_call`)
so reverts surface without spending gas, runs behind an explicit confirmation
that shows the price, and is never auto-retried after broadcast (idempotent via
on-chain state). `buy` ensures a Trinity allowance; `list` ensures NFT approval.

Trading is enabled only when an RPC endpoint **and** deployed contract addresses
are configured (`AppModel(rpcURL:marketAddresses:)`); these land with the #5
verifier-integration deploy. Until then the tab browses and clearly states that
trading isn't available on the network yet. Trinity is a testnet token with no
monetary value, surfaced in the UI. The deterministic encoding/signing pieces
are unit-tested against `cast` vectors; the on-chain round-trip is verified once
addresses are deployed.

## App target (#33)

The reproducible app target lives in [`App/`](App/) — a checked-in XcodeGen
spec (`project.yml`) plus `Info.plist` (usage strings), `StepApp.entitlements`
(App Attest + NFC), `PrivacyInfo.xcprivacy` (PRV-001: no off-device location),
the `@main` composition root, a MetricKit observability hook, and XCUITests. CI
generates the project and builds the app + UI-test bundle on every push (job
`ios-app`). See [`App/README.md`](App/README.md) for generate/run, configuration,
and the App Store / TestFlight review notes.

## What is NOT done yet (requires a physical device, Apple Developer Program, or the #5 deploy — the build machine has Command Line Tools only)

1. **Server-side App Attest verification.** Gateway/validator must verify Apple attestation objects + assertions before accepting `attested` claims (paired backend issue).
2. **MapLibre Native basemap.** The map renders the mesh overlay on MapKit; the full vector basemap (MapLibre Native iOS via SPM) is an app-target integration.
3. **TestFlight distribution.** Apple Developer Program membership, signing (`DEVELOPMENT_TEAM`), App Attest `production` entitlement, `xcodebuild archive` + upload; app-store crypto-rules review (LEG-003/IOS-008) before distribution.
4. **Device/field verification.** App Attest, NFC, and camera are device-only (Simulator degrades to unattested); the marketplace on-chain round-trip needs the #5 deploy. Field tests F1–F9 (`tests/field-tests/`) need physical iPhones in the pilot area.
5. **Accessibility ship gate.** Full-app VoiceOver + Dynamic Type + contrast pass before submission (XCUITests cover the automatable slice).

## Running the core tests

```sh
cd apps/ios/StepCore
swift build   # cross-platform build (verifiable on Command Line Tools)
swift test    # full suite — requires the Xcode toolchain (Testing framework)
```
