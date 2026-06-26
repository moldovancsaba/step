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
| Updates | node-agent verifies artifact sha256 against on-chain `ReleaseRegistry` before activation |
| Observability | `doctor --json`, fleet status, launchd logs, and API status endpoints expose actionable state |

## Blocking failures

- Any fallback that mines or validates outside on-chain rules blocks release.
- Any unverified runtime artifact activation blocks release.
- Any installer that embeds a production private key or long-lived shared secret blocks release.
- Any UI path that cannot explain pending vs active node status blocks release.
