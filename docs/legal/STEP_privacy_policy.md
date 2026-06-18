# STEP — Privacy Policy

**Last updated: 2026-06-18**

> ⚖️ **Counsel review recommended before reliance.** Company details are filled
> in, but you should still have this policy reviewed by qualified counsel for
> GDPR, CCPA/CPRA, and Apple App Store requirements. It is hosted at
> https://regiominer.com/privacy and that URL is entered in App Store Connect.

This Privacy Policy explains how Moldovan Csaba Kft ("STEP", "we", "us")
handles information in connection with the **STEP** iOS application (the
"App"), which is the client for the STEP proof-of-presence protocol and services
(together, the "Service").

STEP is **private by design**. We minimise what we collect, we do **not** sell
personal data, and we do **not** track you across other apps or websites.

## 1. Summary (the short version)

- Your **precise location** is used **only on your device** to determine which
  fixed map triangle ("MESH triangle") you are standing in. **Your exact
  coordinates never leave the device.** Only the resulting **triangle id** and a
  cryptographic **proof hash** are submitted to the Service.
- Your **wallet private key** is generated and stored **on your device** (in the
  iOS Keychain). If you create an account, the key is encrypted **on your
  device** before any backup copy is sent, using a key derived from your
  password that we never receive ("zero-knowledge" vault).
- We use Apple **App Attest** to check that the App is genuine; this returns a
  hardware-backed token, not your identity.
- The blockchain is **public and permanent**: your wallet address, the triangles
  you mine, and your token/NFT activity are visible on-chain by design.
- The in-app token, **Trinity**, is a **testnet** token with **no monetary
  value** and cannot be purchased with money.

## 2. Information we process

**(a) Location data.** When you tap to mine or open the map, the App reads your
device location with your permission. The raw latitude/longitude is processed
**on-device** to compute a MESH triangle id and is **not transmitted** to us or
stored on our servers. We never run background location tracking.

**(b) On-chain data.** To record a proof of presence we submit a signed claim
containing: the MESH **triangle id**, your **wallet address**, a **timestamp**,
a **nonce**, a **proof hash**, and (if you opt in) device-attestation and
trusted-anchor evidence. This data is written to a public blockchain and is, by
nature, **public, immutable, and not erasable by us**.

**(c) Account data (optional).** If you create an account, we process the
**identifier** you choose (e.g. email or username) and an **encrypted wallet
vault** plus a derived **authentication key**. Your password and your wallet
private key are **never sent to us in a form we can read**.

**(d) Device integrity data.** With Apple **App Attest / DeviceCheck**, the App
generates a hardware-backed assertion bound to each proof. We receive the
assertion and a key identifier, not your Apple ID or personal identity.

**(e) Trusted-anchor data (optional).** If you choose to verify with a trusted
anchor, the App reads a signed challenge from a nearby Bluetooth beacon, NFC
tag, or QR code. It binds only to your wallet address and the proof nonce — no
additional personal information.

**(f) Diagnostics.** The App may collect **aggregate, non-personal** performance
and crash diagnostics via Apple **MetricKit** to keep the App stable. These
contain no coordinates and no account content.

We do **not** collect contacts, photos, browsing history, advertising
identifiers, or health data, and we do **not** use third-party advertising or
analytics SDKs.

## 3. How we use information

- To resolve your current MESH triangle and let you submit proofs of presence.
- To verify proofs (validators and smart contracts) and to detect fraud or
  spoofing (device attestation, trusted anchors).
- To operate the optional account/login and the zero-knowledge wallet backup.
- To display the map, your wallet, and the marketplace.
- To keep the App reliable and secure (aggregate diagnostics).

## 4. Legal bases (GDPR, where applicable)

Performance of a contract (providing the Service you request), our legitimate
interests (security, fraud prevention, reliability), and your consent (location,
Bluetooth, NFC, and camera permissions, which you may withdraw at any time in
iOS Settings).

## 5. Sharing and disclosure

We share information only as needed to run the Service:

- **Public blockchain:** on-chain claim data is published to a public ledger.
- **Apple:** App Attest/DeviceCheck and MetricKit are processed by Apple under
  Apple's terms.
- **Infrastructure providers:** the STEP gateway, indexer, account, and RPC
  endpoints that you connect to.
- **Legal:** where required by law or to protect rights and safety.

We do **not** sell or rent personal data, and we do not share it for advertising.

## 6. Data retention

On-chain data is **permanent and cannot be deleted**. Account identifiers and
encrypted vaults are retained while your account is active and deleted on
request (subject to legal retention). On-device data (your key, cached
parameters) remains on your device until you delete the App or sign out and
remove the key.

## 7. Your rights

Depending on where you live, you may have rights to access, correct, delete, or
port your personal data, and to object to or restrict processing. To exercise
them, contact us at `privacy@regiominer.com`. Note that we **cannot alter or
erase blockchain records**, which are outside our control by design; we will
help you understand what is and is not on-chain. You may also withdraw device
permissions at any time in iOS Settings.

## 8. Security

Your wallet key is held in the iOS Keychain and, for backups, encrypted with a
password-derived key using strong, standard cryptography (Argon2id key
derivation, AES-256-GCM encryption). Network traffic uses TLS. No method is
perfectly secure, but we apply industry-standard protections and the principle
of data minimisation throughout.

## 9. Children

The App is **not directed to children** and is rated for users **17+**. We do
not knowingly collect personal data from children. If you believe a child has
used the App, contact us and we will take appropriate action.

## 10. International transfers

The Service may be operated from, and data processed in, countries other than
yours. Where required, we use appropriate safeguards for international transfers.

## 11. Changes

We may update this Policy. We will post the new version with a revised "Last
updated" date and, where appropriate, notify you in the App.

## 12. Contact

**Moldovan Csaba Kft**
1125 Budapest, Diós árok 49/a, Hungary
Company registration No.: 01-09-388294 · Tax No.: HU27395842
Email: privacy@regiominer.com (interim: moldovancsaba@gmail.com)
