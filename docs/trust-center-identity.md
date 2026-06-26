# Trust Center identity and wallet ownership

A STEP Trust Center has two separate identities:

1. Node identity: a secp256k1 key generated on the Mac and stored in the macOS Keychain. The node identity signs operational messages and identifies the machine.
2. Wallet identity: the user's mobile wallet key. The wallet owns the node for reward routing and account UX.

These identities are intentionally separate. A wallet can own a node without that node being an active validator. Validator activation remains a registry/admin/quorum concern and is not bypassed by wallet pairing.

## Pairing contract

`TrustCenterRegistry` stores:

```solidity
nodeOwner[node] -> owner wallet
rewardRecipient[node] -> reward wallet
nodeStatus[node] -> none | pending | active | suspended | revoked
usedPairingDigest[digest] -> replay protection
```

Pairing requires an owner wallet signature over:

```text
keccak256(abi.encode(
  keccak256("STEP_TRUST_CENTER_PAIR_V1"),
  chainId,
  TrustCenterRegistry address,
  node address,
  owner wallet,
  challenge bytes32,
  expiresAt unix seconds
))
```

The signed message uses the Ethereum personal-sign prefix for a 32-byte digest.

## Runtime flow

1. The Mac installs the package.
2. `step-trustcenter provision` generates or loads the node identity.
3. The command prints a `step.trustcenter.pair` payload.
4. The mobile wallet validates the payload, signs the pairing digest, and submits `POST /v1/trust-centers/pair`.
5. The gateway relays `TrustCenterRegistry.pairNode`.
6. Fleet views expose owner, reward recipient, registry status, and validator weight.

## Security boundaries

Wallet pairing does not:

- grant validator voting weight
- bypass release registry verification
- bypass nonce, geolocation, mining, or quorum rules
- recover or export the node private key

Wallet pairing does:

- bind a node address to a wallet address
- set the default reward recipient to the owner wallet
- permit the owner to update reward recipient
- provide user-level ownership UX for future incentives

## Operational states

`none`: no owner has paired this node.

`pending`: wallet owns the node, but it is not active as a validator.

`active`: governance/operator activation marks the node active. Voting weight still comes from `ValidatorRegistry`.

`suspended`: temporarily blocked from active operation.

`revoked`: permanently invalid for this node identity. Reprovision to create a new identity.
