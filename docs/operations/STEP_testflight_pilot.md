# TestFlight pilot — ship STEP to friendly testers

> Get the iOS app into friendly testers' hands. The app is re-pointed off the
> `*.step.example` placeholders to the **live tunnel backend** (gw/idx/acc/nft
> .step.regiominer.com). What remains is owner-gated: it needs your Apple
> credentials (Claude can't enter signing secrets) and your DNS edit.
>
> Build identity: app **STEP — Proof of Presence**, bundle `com.regiominer.miner`,
> App ID `6781713930`, Team `GZE5C5C4L8`. **0.1.0(1)** is already live on
> TestFlight; this ships **0.1.0(2)** (build number bumped in `project.yml`).

## Prerequisite — backend reachable at the real URLs (one-time)

The app now talks to four hosts. The tunnel `step-backend`
(`329b02b6-46bb-4273-8751-a4909f9b900f`) is already boot-persistent on tribecca.

1. **Bring the backend up** on tribecca (serves the four services the app calls):
   ```bash
   node scripts/dev/up.mjs        # gateway :8080, indexer :8090, account :8091, nft :8092
   node scripts/ops/backend-tunnel.mjs --install   # prints the exact DNS + ingress to add
   ```
2. **👤 Add four PROXIED CNAMEs** in the `regiominer.com` zone, all →
   `329b02b6-46bb-4273-8751-a4909f9b900f.cfargotunnel.com` (the CF API token
   can't edit DNS, so this is a manual dashboard step):

   | hostname | → service |
   |---|---|
   | `gw.step.regiominer.com` | gateway-api :8080 |
   | `idx.step.regiominer.com` | indexer :8090 |
   | `acc.step.regiominer.com` | account-api :8091 |
   | `nft.step.regiominer.com` | nft-indexer :8092 |

3. **👤 Add the `acc`/`nft` ingress rules** in the CF tunnel dashboard
   (gw/idx already exist) → `http://127.0.0.1:8091` and `:8092`.
4. **Verify** each host answers over the edge:
   ```bash
   for h in gw idx acc nft; do echo -n "$h: "; curl -s -o /dev/null -w "%{http_code}\n" https://$h.step.regiominer.com/health || echo down; done
   ```

> Mining (the core test) needs only `gw` + `idx`. `acc` (wallet vault) and `nft`
> (marketplace) make the rest of the app work; skip them only if you scope the
> pilot to mining and tell testers so.

## Build + upload (0.1.0(2))

Apple key is already on disk: `~/.appstoreconnect/private_keys/AuthKey_24882Q9AM6.p8`
(Key ID **24882Q9AM6**, Issuer **50da2e06-9a19-4a5f-a183-13f82dff3137**).

```bash
cd apps/ios/App
xcodegen generate                        # regenerate the project with the new URLs + build (2)

# Archive (signed — DEVELOPMENT_TEAM/signing must be set; do this in your logged-in Xcode/CLI)
xcodebuild -project StepApp.xcodeproj -scheme StepApp \
  -configuration Release -archivePath build/StepApp.xcarchive \
  -destination 'generic/platform=iOS' archive

# Export the .ipa (needs an ExportOptions.plist with method=app-store-connect, your team id)
xcodebuild -exportArchive -archivePath build/StepApp.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export

# Upload to App Store Connect with the API key on disk
xcrun altool --upload-app -f build/export/StepApp.ipa -t ios \
  --apiKey 24882Q9AM6 --apiIssuer 50da2e06-9a19-4a5f-a183-13f82dff3137
```

> `altool` is the supported CLI path and uses the key file above — no password.
> If you prefer, the same archive uploads from Xcode → Organizer → Distribute.

## Invite friendly testers (App Store Connect)

In **App Store Connect → STEP → TestFlight** (a web UI; sign in there — Claude
can't, these are your credentials):

1. Wait for build **0.1.0 (2)** to finish processing (a few minutes).
2. **External testing** (for friends outside your team): create a group, e.g.
   *Friendly Pilot*, add the build, fill **Test Information** (what to test,
   a contact email, the privacy/usage notes already in `Info.plist`).
   - External builds need a **Beta App Review** (usually <24h). Internal testers
     (up to 100 on your team, no review) get it instantly — fastest first taste.
3. **Add testers by email** (paste your friends' emails) or enable the **public
   link** and share that. Apple emails each tester the TestFlight invite.
4. Testers install **TestFlight** from the App Store, tap the invite, install STEP.

## What testers will see

- Mine by presence → claim finalises on the **sovereign chain** → Trinity + twin
  mint (full flow proven end-to-end on evmd).
- Wallet vault (acc) + marketplace (nft) if you added those two hosts.

## Rollback

- Bad build: in TestFlight, **stop distributing** the build / expire the group —
  testers keep the prior build, no store impact (TestFlight ≠ public App Store).
- Backend issue: `node scripts/ops/backend-tunnel.mjs --uninstall` drops the edge;
  fix on tribecca; re-install. The app degrades to connection errors, not data loss.
