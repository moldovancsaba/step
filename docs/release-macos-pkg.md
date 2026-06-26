# macOS package release process

The official desktop Trust Center distribution is a macOS `.pkg` installer.

## Build

```bash
pnpm release:macos-pkg -- --version 1.0.0 --platform darwin-arm64
```

Output:

```text
.runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg
.runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg.sha256
```

## Local acceptance

```bash
pnpm release:macos-pkg:test -- --pkg .runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg
```

This verifies:

- package sha256 sidecar
- package expands successfully
- required installed commands exist
- provision/start/doctor/logs/uninstall behavior is present
- pairing payload support is present

Optional install check on a disposable Mac:

```bash
pnpm release:macos-pkg:test -- --pkg .runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg --install
```

## Notarize

```bash
pnpm release:macos-pkg:notarize -- --pkg .runtime/dist/STEP-TrustCenter-1.0.0-darwin-arm64.pkg
```

Required environment:

```text
APPLE_TEAM_ID
APPLE_ASC_KEY_ID
APPLE_ASC_ISSUER_ID
```

The private key must exist outside the repository at `~/.appstoreconnect/private_keys/AuthKey_<APPLE_ASC_KEY_ID>.p8` or `~/.private_keys/AuthKey_<APPLE_ASC_KEY_ID>.p8`.

## Publish

The package is not the authority for runtime updates. Runtime update authority is the on-chain `ReleaseRegistry`. The package bootstraps the node-agent; the agent only activates artifacts whose hashes are authorized on-chain.

## Rollback

Rollback is performed by promoting a previous authorized release version in the release registry and allowing node agents to converge. If local package installation itself must be rolled back, install the previous notarized package and run:

```bash
step-trustcenter restart
step-trustcenter doctor --json
```
