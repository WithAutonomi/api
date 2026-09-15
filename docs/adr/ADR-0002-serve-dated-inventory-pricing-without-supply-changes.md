<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Authored for API using the template from WithAutonomi/adr-standard @ 27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408. See NOTICE. -->

# ADR-0002: Serve dated Inventory pricing without supply changes

- **Status:** Proposed
- **Date:** 2026-09-14
- **Decision owners:** Jim Collinson and API maintainers
- **Reviewers:** API maintainers (pending)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** [Shared specification (sibling worktree)](../../../pricing-slim-site/planning/pricing-slim-spec.md); [supply baseline](https://github.com/WithAutonomi/api/blob/b8c5fb557049d0163b99c29f23708ec02ced7255/worker/index.js)

## Context

Serve dated estimates from returned observations, not guaranteed quotes or exhaustive
network coverage. Inventory owns collection, calculations and authoritative maths tests.

## Decision Drivers

- One pricing authority; thin serving; unchanged supply.

## Considered Options

1. Request-time collection/calculation: duplicates Inventory and provider failures.
2. Separate service: unnecessary operational overhead.
3. Isolated reader in the existing Worker: chosen.

## Decision

`/api/pricing` reads one Inventory-published record envelope from KV, a key-value store.
The shared specification defines its storage and HTTP contract. Revision, hash and
publication metadata are diagnostic only.

Apply bounded, basic validation: required shapes, supported calculation, positive rates,
real ordered dates and internally consistent adjustable windows. Ignore unknown fields.
Do not validate producer evidence, recompute hashes/examples, execute the model or call providers.

Valid saved pricing never expires. Observation, currency, generation and publication dates
stay distinct and unchanged; averaging windows do not impose expiry. Missing or invalid
data makes pricing unavailable, not fabricated.

Only pricing accesses pricing storage. Preserve every supply behavior, provider/fallback
and the unchanged health response. Root/llms share truthful discovery descriptions.

## Consequences

### Positive

- Independent data updates; failures isolated from supply.

### Negative / Trade-offs

- Shared deployment needs regression protection; dated data may be old.

### Neutral / Operational

- API trusts Inventory's derivation, not a duplicated evidence system.

## Validation

Test indefinite age, changed/mismatched windows, unavailable records, one-key isolation,
zero pricing provider calls, supply/health baseline parity and discovery consistency.

## Notes for AI-assisted work

AI tools may help draft this ADR, but **must not mark it Accepted without human review**. Accepted ADRs are immutable: create a new superseding ADR rather than editing an Accepted ADR.
