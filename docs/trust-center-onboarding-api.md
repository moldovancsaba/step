# Trust Center onboarding API

The gateway exposes Trust Center onboarding endpoints when `TrustCenterRegistry` is present in deployments or `TRUST_CENTER_REGISTRY` is configured.

## POST /v1/trust-centers/pair

Pairs a desktop node identity to a mobile wallet.

Request:

```json
{
  "type": "step.trustcenter.pair",
  "version": 1,
  "nodeAddress": "0x1111111111111111111111111111111111111111",
  "ownerWallet": "0x2222222222222222222222222222222222222222",
  "challenge": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expiresAt": 1800000000,
  "signature": "0x...65-byte-personal-signature"
}
```

Responses:

```json
{
  "nodeAddress": "0x1111111111111111111111111111111111111111",
  "ownerWallet": "0x2222222222222222222222222222222222222222",
  "rewardRecipient": "0x2222222222222222222222222222222222222222",
  "status": "pending",
  "activeWeight": "0",
  "nextAction": "wait_for_validator_activation",
  "txHash": "0x..."
}
```

Errors:

- `400 invalid_pairing_payload`: request shape, addresses, challenge, signature, or expiry is invalid.
- `409 chain_revert:<reason>`: contract rejected the pairing.
- `503 trust_center_registry_unconfigured`: gateway is not connected to the registry.

## GET /v1/trust-centers/:nodeAddress

Returns registry ownership, reward recipient, operational status, validator weight, and next action.

## GET /v1/trust-centers/:nodeAddress/onboarding-status

Alias for status polling by installer/mobile onboarding screens.

## Timeouts and retries

Clients should retry idempotent `GET` calls with exponential backoff. Clients must not blindly retry `POST /pair` with a new challenge without user consent because pairing is a wallet signature action. A repeated identical pairing digest is rejected by contract replay protection.
