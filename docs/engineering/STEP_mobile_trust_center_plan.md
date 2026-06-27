# Plan — mobile app as a trust center (light-client quorum signer)

> Turns a phone running the STEP app into a real, quorum-weighted trust center
> **while the app runs** without representing it as a 24/7 consensus validator.
> The product launcher and foreground Mobile Trust Center surface now exist in
> the iOS app. The remaining protocol work is vote digest parity, attested
> enrollment, gateway vote intake, and field verification on physical devices.
> Each remaining step is independently shippable and CI-gated.

## What "trust center" means mechanically here

A trust center is an address **registered in `ValidatorRegistry` with weight**
whose secp256k1 signature over the **EIP-712 `StepValidatorVote` digest** is
collected by the gateway into `finaliseNaturalClaim(...)`, where
`MiningClaimVerifier` recovers each signer and sums their weight against
`quorumThresholdWeight`. The phone already holds the right key primitive (the
account vault, #12, via `secp256k1.swift`) and already proves the device (App
Attest, #31). The gap is: **reproduce the vote digest in Swift, sign it, get the
key registered with weight, and submit the vote.**

The exact digest to reproduce is `packages/validation-rules/src/sign.rs`
(`eip712_vote_digest`): domain `EIP712Domain` name=`StepMiningClaim` version=`1`
chainId=`262144` verifyingContract=`MiningClaimVerifier`; struct
`StepValidatorVote(bytes32 claimHash,bytes32 triangleId,address miner,bool approve)`.
It must match **bit-for-bit** or the on-chain recovery yields the wrong address.

## Current app surface

The iOS app now presents a post-wallet launcher with two modes:

- `Mine & explore` for the normal mining, wallet, map, and marketplace flow.
- `Mobile Trust Center` for a foreground iPhone/iPad trust-device mode.

The Mobile Trust Center screen exposes active/paused state, wallet identity, App
Attest readiness, future vote-signing capability, and reward-model caveats. It
does not claim background execution, boot restart, local chain RPC, gateway/fleet
hosting, or package self-update. Those remain full Trust Center responsibilities.

## Step 1 — Swift EIP-712 signing module (the crux) · 🤖 autonomous

New `StepCore/Sources/StepCore/TrustVote.swift`:
- `keccak256(_:)` — Ethereum keccak (NOT CryptoKit SHA3-256). Add a small
  pure-Swift Keccak-f[1600] (~120 lines, public-domain algorithm) → **no new
  dependency** (rule 5). Golden-vector test: `keccak256("")` ==
  `c5d2460186…85a470` (same vector the Rust side asserts).
- `eip712VoteDigest(chainId:verifyingContract:claimHash:triangleId:miner:approve:)`
  — port `domain_separator` + struct hash + `\x19\x01` framing verbatim.
- `signVote(digest:key:) -> Data` (65-byte r‖s‖v, v∈{27,28}) using
  `secp256k1.swift` recoverable signing; mirror `sign_digest`.
- **Parity test (the gate that matters):** bake golden vectors emitted by the
  Rust impl (add a `#[test]` that prints `eip712_vote_digest(...)` hex for fixed
  inputs, capture once) and assert the Swift output equals them. If Swift ≠ Rust,
  the build fails — this is what guarantees a phone vote finalises on-chain.

Exit: `swift test` proves Swift digests == Rust digests for ≥3 vectors incl. the
live chainId 262144 + the deployed `MiningClaimVerifier` address.

## Step 2 — device registration with attestation-gated weight · 🤖 code + 👤 policy

A phone's vote only counts once its address has registry weight. Registration is
an **explicit on-chain grant** — never self-granted (keeps trust honest).
- App: on first run, derive the vault key's address; send `{address, App Attest
  assertion}` to a new gateway endpoint `POST /v1/trust/enroll`.
- Gateway: verify the App Attest assertion (the #31 path already validates
  attestations), then call `registerValidator(address, type=Mobile, weight=W)`
  via the hub admin key (same path as `scripts/node/register.mjs`).
- **DECISION (owner):** the mobile weight `W` and type. Recommend a **small**
  per-device weight (e.g. 1–5 vs infra's 50) and a **cap on total mobile weight**
  vs infra weight, so a flood of phones can't outvote the always-on validators.
  This is a `config/protocol-params.alpha.json` param (`mobileTrustWeight`,
  `mobileWeightCapBps`) — never hardcoded (repo rule).

Exit: an enrolled device appears in `ValidatorRegistry` with the configured
weight; a non-attested device is rejected (fail-closed).

## Step 3 — sign & submit a vote · 🤖 autonomous

- When the miner mines (or witnesses a claim it can attest), build the same
  `Claim` canonical message the gateway uses, compute `claimHash` +
  `triangleIdHash`, sign the vote digest (Step 1), and `POST` the `SignedVote`
  `{validator,signature,claimHash,triangleIdHash,miner,approve}` to the quorum
  intake the gateway/validator already expose (`/validate` returns one today;
  add an `/v1/trust/vote` ingest that accepts an externally-produced vote and
  folds it into the same `sortedApprovals` bundle).
- Event-driven, foreground — no background daemon, no liveness obligation.

Exit: a claim finalises on-chain with a **phone-produced** approval in the
weighted set (prove in an e2e test: phone-signed vote recovers to the enrolled
address and contributes weight to `finaliseNaturalClaim`).

## Step 4 — light-client reads (trust-minimised) · 🤖 mostly done

The app reads frontier/state via the gateway today. Harden to match the node's
§4 model: read from ≥2 endpoints and require agreement before acting (the Rust
`agreement::agree` logic; port the check or expose a gateway "agreed read"). Low
effort, removes single-gateway trust for the phone.

Exit: the app refuses to act on a value that two independent endpoints disagree on.

## Step 5 — UX + observability · 🤖 autonomous (GDS)

- A "Trust center" surface in the app (GDS components only, accessible): enrolled
  state, this device's weight, votes contributed, last vote time.
- Local log of vote hashes + verdicts only — **no raw GPS** (privacy invariant).

## Sequencing & risk

1 → 2 → 3 are the critical path (1 unblocks 3; 2 is parallel but needs the policy
param). 4 and 5 are independent polish. The single highest-risk item is **Step 1
parity** — mitigated by golden vectors. The only owner input needed is the
**Step 2 weight policy** (one params decision); everything else is autonomous.

## Out of scope (explicitly)

Phone-as-consensus-validator (covered + rejected in §9). No background execution,
no always-on signing, no staking from the phone.
