# STEP dictionary

`STEP` - The whole proof-of-location mining system.

`Trinity` - The smallest indivisible unit rewarded by mining.

`1 STEP` - The first mining reward amount, equal to `67,108,864 Trinity`.

`Triangle` - A specific geographic cell on Earth in the spherical triangle mesh.

`Root triangle` - One of the first large Earth-covering triangles available at system start.

`Triangle level` - The subdivision depth of a triangle, where higher levels are smaller triangles.

`Mine a triangle` - A user physically enters a mineable triangle and proves they are inside it.

`Mining slot` - One allowed mining position inside a triangle's reward schedule.

`First miner` - The wallet that mines a triangle's first slot and receives `1 STEP`.

`Same-wallet replay` - A rejected attempt by the same wallet to mine the same triangle again before it breaks down.

`Triangle exhaustion` - The state when all mining slots of a triangle have been used.

`Triangle breakdown` - The automatic split of an exhausted triangle into four smaller child triangles.

`Child triangle` - One of the four smaller triangles created when a parent triangle breaks down.

`Mineable triangle` - A triangle that is currently open for mining in the live mesh state.

`Non-mineable triangle` - A triangle that cannot currently be mined because its parent is not exhausted, it is exhausted, frozen, or otherwise closed.

`Mesh` - The global spherical triangle system covering Earth.

`Mesh state` - The current live record of which triangles are open, mined, exhausted, or split.

`Proof of location` - Evidence that a wallet/device was physically inside a specific triangle.

`Claim` - A user's submitted proof that they are inside a triangle and want to mine it.

`Claim hash` - The unique cryptographic fingerprint of a claim.

`Validator` - A node that independently checks a claim and signs an approve/reject vote.

`Validation` - The process of checking location, accuracy, nonce, wallet, triangle, and fraud rules.

`Vote` - A validator's signed approve or reject decision for a claim.

`2/3 + 1 quorum` - The validator approval threshold where more than two-thirds of validator weight must approve before a claim can be finalized.

`Bundle` - The claim plus enough validator votes to finalize mining.

`Finalise claim` - The act of submitting an approved bundle to the blockchain.

`Rejected claim` - A claim that failed validation or could not reach quorum.

`Nonce` - A one-time value used to prevent replaying the same claim.

`Nonce rejected` - The claim reused, expired, or submitted an invalid one-time value.

`Accuracy too low` - The device location accuracy was not precise enough for the target triangle.

`No fallback` - The system must fail clearly instead of silently switching to another level or fake mode.

`Wallet` - The user's cryptographic identity used to mine and hold Trinity.

`Wallet file` - The downloadable/uploadable file used to save and restore a wallet.

`Miner` - A wallet/user attempting to mine triangles.

`Trinity balance` - The amount of Trinity owned by a wallet.

`Mining NFT` - The unique on-chain record representing a mined triangle slot/location event.

`Triangle token` - The tokenized representation of a mined triangle slot.

`Twin reward` - The protocol/foundation-side mirrored allocation created from mining rewards.

`Treasury` - The contract/account holding protocol-controlled Trinity.

`Smart contract` - Blockchain code enforcing mining, rewards, wallets, rules, and state.

`On-chain state` - Data enforced by the blockchain and not just by a server.

`Indexer` - A service that reads blockchain events and exposes searchable mesh/mining state.

`Gateway` - The API entry point that receives claims and coordinates validation/finalization.

`Proof storage` - Encrypted off-chain storage for evidence bundles.

`Evidence bundle` - The detailed proof package stored off-chain and referenced by hash on-chain.

`P2P node` - A peer machine that participates in decentralized validation, gossip, and system operation.

`Trust Center` - A user-operated node that helps run the STEP network and may later earn rewards.

`Node agent` - The local service that manages node health, updates, recovery, and supervision.

`Gossip node` - The P2P component that shares claims and validator votes between peers.

`Peer discovery` - How nodes find other nodes in the network.

`Bootstrap peer` - A known peer used by a new node to join the network.

`Chappie` - The remote Mac/node being prepared as one STEP peer.

`Tribecca` - The local Mac/node being prepared as another STEP peer.

`Public edge` - The public HTTPS entry point used by web/mobile clients to reach the network.

`Cloudflare Worker` - The deployed edge web/API router currently serving the public web app.

`Web app` - The browser interface for wallet, mining, mesh viewing, and status.

`Mobile app` - The iOS app for wallet, mining, proof capture, and TestFlight distribution.

`TestFlight build` - The Apple-distributed beta build of the iOS app.

`Build 0.1.0 (2)` - The current valid TestFlight/App Store Connect build version.

`Friendly Pilot` - The current TestFlight beta tester group.

`Autoupdate` - The node system updating itself without manual reinstall.

`Recovery` - The node restoring itself after crash, corruption, or failed update.

`Supervisor` - The process responsible for restarting services when they crash.

`Health check` - A machine-readable endpoint or command proving a service is alive.

`Fail closed` - If something required is missing or invalid, the system rejects instead of guessing.

`Sandbox` - A temporary/dev mode that must not be confused with the real production system.

`Production mode` - Real deployed operation with no fake data, no localhost dependency, and enforced rules.

`Fake data` - Any hardcoded/demo state that must not affect the real mining system.

`Localhost` - A machine-only address that must not be required for the public/P2P system.

`Deployment` - Publishing the current system version to a live environment.

`CI` - GitHub automated checks that test contracts, Rust, web, iOS, schemas, and e2e.

`Green CI` - All automated GitHub checks are passing.

`Main branch` - The canonical branch representing the latest delivered code.

`PR branch` - A working branch containing changes before or alongside merging to main.
