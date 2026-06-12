# STEP Documentation

**Date:** 2026-06-12 · **Status:** alpha engineering baseline

STEP is a proof-of-location / proof-of-presence blockchain system on a deterministic spherical triangular MESH of the Earth. Miners mine by physically visiting a triangle and submitting a verifiable proof-of-presence; the smallest unit is Trinity; businesses fund Trinity oases that pay for verified visits. STEP is **not** a walking/fitness/move-to-earn app — step counts and health data are never protocol inputs.

## Document map

### Controlling engineering documents (read first)
- [Requirements matrix](engineering/STEP_requirements_matrix.md) — every requirement, sourced, classified, alpha-scoped
- [Delivery roadmap](engineering/STEP_delivery_roadmap.md) — milestones M0–M6
- [Architecture decision records](engineering/STEP_architecture_decision_records.md) — 17 ADRs + 10 OPEN decisions
- [Alpha scope](operations/STEP_alpha_scope.md) — binding IN/OUT list (this file is the master prompt's "alpha delivery scope")
- [Test plan](engineering/STEP_test_plan.md)

### Product & architecture
- [Product specification](product/STEP_product_specification.md)
- [High-level architecture](architecture/STEP_high_level_architecture.md)
- [Atomic system design](architecture/STEP_atomic_system_design.md)

### Protocol
- [Proof-of-presence protocol](protocol/STEP_proof_of_presence_protocol.md)
- [Validator protocol](protocol/STEP_validator_protocol.md)

### Geography
- [MESH mathematics (step-mesh-v1, frozen)](geography/STEP_mesh_mathematics.md)
- [Spherical triangle engine](geography/STEP_spherical_triangle_engine.md)

### Tokenomics
- [Tokenomics constitution (DRAFT — parameters UNFROZEN)](tokenomics/STEP_tokenomics_constitution.md)
- [Trinity exchange design (phased; alpha = closed credits)](tokenomics/STEP_trinity_exchange_design.md)
- [Foundation treasury rules](tokenomics/STEP_foundation_treasury_rules.md)

### Contracts, merchant, privacy, legal
- [Smart contract specification](smart-contracts/STEP_contract_specification.md)
- [Merchant campaign system](merchant/STEP_merchant_campaign_system.md)
- [Trinity oasis logic](merchant/STEP_trinity_oasis_logic.md)
- [Privacy and location data](privacy/STEP_privacy_and_location_data.md)
- [Legal risk register](legal-risk/STEP_legal_risk_register.md)

### Engineering & operations
- [Development plan](engineering/STEP_development_plan.md)
- [Repository structure](engineering/STEP_repository_structure.md)
- [API contracts](engineering/STEP_api_contracts.md)
- [Data models](engineering/STEP_data_models.md)
- [Incident response](operations/STEP_incident_response.md)
- [Release log](operations/STEP_release_log.md)

## Source documents

The three controlling planning documents (complete system, development open-source/Apple-first, hardening) live outside the repo with the project owner; the requirements matrix cites them as SYS/DEV/HARD per section.
