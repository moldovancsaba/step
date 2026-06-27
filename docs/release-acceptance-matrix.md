# STEP release acceptance matrix

A Trust Center release is acceptable only when every layer below has a passing acceptance result.

| Layer | Acceptance |
| --- | --- |
| Installer | `.pkg` builds, sha256 sidecar matches, package expands, commands are present |
| Notarization | `xcrun notarytool submit --wait`, `xcrun stapler staple`, `spctl --assess --type install` |
| Provisioning | `step-trustcenter provision --json` creates Keychain identity, env file, LaunchAgent, and pairing payload |
| Lifecycle | `start`, `stop`, `restart`, `status`, `doctor`, and `logs` work without manual file edits |
| Recovery | corrupted local env can be regenerated; full wipe removes LaunchAgent/env and optionally Keychain identity |
| Pairing | mobile wallet validates payload, signs digest, gateway relays `TrustCenterRegistry.pairNode` |
| Registry | paired node becomes `pending`; activation is separate from wallet ownership |
| Fleet | fleet API reports owner wallet, reward recipient, Trust Center status, and validator active weight |
| Updates | node-agent verifies canonical manifest hash, chunk root, chunk hashes, package hash, binary hash, params hash, and config hash against on-chain `ReleaseRegistry` before activation |
| Observability | `doctor --json`, fleet status, launchd logs, and API status endpoints expose actionable state |

## Blocking failures

- Any fallback that mines or validates outside on-chain rules blocks release.
- Any unverified runtime artifact activation blocks release.
- Any release artifact source missing a contract-matching manifest and chunk index blocks swarm-update acceptance.
- Any installer that embeds a production private key or long-lived shared secret blocks release.
- Any UI path that cannot explain pending vs active node status blocks release.

## M11 public edge acceptance

| Layer | Acceptance |
| --- | --- |
| Deploy guard | Production deploy rejects localhost, loopback, private LAN, and non-HTTPS backend URLs |
| Worker edge | `/api/*` routes are same-origin and return route metadata headers |
| Peer directory | `/api/peers/healthy` returns only active, public HTTPS, non-expired peers |
| Peer router | GET routes retry bounded healthy peers; unsafe writes fail closed without silent fallback |
| Client config | Browser defaults to `/api/gateway` and `/api/indexer`; no production client localhost fallback exists |
| Mining safety | If indexer state is unavailable, mining stops instead of guessing a lower or fallback level |
| Release gate | `pnpm release:public-edge:verify` passes before public deployment is accepted |

Blocking failures:

- Production Worker deploy succeeds with localhost/private backend config.
- Browser request capture shows `localhost` or `127.0.0.1` for production API calls.
- Worker returns fake success when no healthy peer exists.
- Mining proceeds when indexer/mineable frontier state is unavailable.
