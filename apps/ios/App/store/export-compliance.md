# Export compliance (encryption)

> ⚖️ Confirm with counsel / your export advisor before first submission. This
> records the engineering basis for the declaration; it is not legal advice.

## What encryption the app uses

STEP uses **only standard, published, widely-available cryptography**:

- **TLS/HTTPS** for all network transport (provided by the OS).
- **AES-256-GCM** (Apple CryptoKit) to encrypt the wallet vault for optional
  account backup.
- **Argon2id** for password-based key derivation.
- **secp256k1 / keccak-256** for wallet signing and proof hashing.

There are **no proprietary or non-standard cryptographic algorithms**, and the
app does not provide encryption as a primary feature to third parties.

## Declaration

`Info.plist` sets:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

Rationale: the app's use of encryption is limited to standard algorithms for
authentication, data protection, and digital signatures. Under U.S. EAR Category
5 Part 2, this generally qualifies for exemption (e.g. §740.17(b) /
mass-market), so **no annual self-classification report (ANNUAL SELF
CLASSIFICATION) or CCATS is expected to be required**.

If your legal/export review concludes the exemption does **not** apply (for
example, due to how the wallet-vault encryption is characterised), then:

1. Set `ITSAppUsesNonExemptEncryption` to `true`.
2. Complete the encryption questions in App Store Connect, providing the
   exemption category or your CCATS/ERN, and file the annual self-classification
   report with BIS and the ENC encryption registration as required.

## Action before submission

- [ ] Export/legal review of the above sign-off.
- [ ] Confirm the `ITSAppUsesNonExemptEncryption` value matches that conclusion.
- [ ] If non-exempt, attach the year-end self-classification report reference.
