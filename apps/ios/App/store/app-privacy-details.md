# App Privacy details (App Store Connect "nutrition label")

These are the answers to enter under **App Store Connect → App Privacy**. They
match the app's actual behaviour and the `PrivacyInfo.xcprivacy` manifest. The
guiding fact: **precise location is processed on-device and never transmitted**;
only a triangle id + proof hash + wallet address go on-chain.

## Data used to track you

**No.** STEP does not track users and uses no third-party advertising/analytics.
`NSPrivacyTracking = false`, no tracking domains.

## Data collected

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| **Precise Location** | Yes | No | No | App Functionality — resolve the MESH triangle on-device. Raw coordinates are **not** sent off device. |
| **Coarse Location** | No | — | — | — |
| **User ID** (wallet address) | Yes | No | No | App Functionality — on-chain proof of presence; pseudonymous. |
| **Other User Content** (account identifier + encrypted wallet vault) | Yes (only if the user creates an account) | Yes (to the account) | No | App Functionality / Account — zero-knowledge backup; password & key never received in readable form. |
| **Crash Data / Performance Data** | Yes | No | No | App Functionality — aggregate MetricKit diagnostics, no coordinates/content. |
| Contacts, Photos, Browsing History, Search History, Health, Financial Info, Purchases, Advertising Data | No | — | — | — |

Notes for the reviewer questionnaire:

- For **Precise Location**, choose purpose **App Functionality** only; mark **not
  linked to the user** and **not used for tracking**. (Apple's questionnaire asks
  whether the *type* is collected; location leaves the device only as a derived
  triangle id, but declare Precise Location conservatively as "collected → App
  Functionality, not linked, no tracking".)
- For **User ID**, the wallet address is pseudonymous and public on-chain.
- **Other User Content** applies only when the optional account is used.

## Required-reason APIs (`PrivacyInfo.xcprivacy`)

- **UserDefaults** — reason `CA92.1` (access info only accessible to the app
  itself: cached KDF parameters / attest key id).

Keep `PrivacyInfo.xcprivacy` and these answers in sync if data use changes.
