<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Authored for API using the template from WithAutonomi/adr-standard @ 27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408. See NOTICE. -->

# ADR-0002: Serve Inventory pricing while preserving supply contracts

- **Status:** Proposed
- **Date:** 2026-09-09
- **Decision owners:** Jim Collinson and API maintainers
- **Reviewers:** API maintainers (review pending)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** [Pricing API specification](../specs/pricing-api.md); [Supply contract baseline](https://github.com/WithAutonomi/api/blob/b8c5fb557049d0163b99c29f23708ec02ced7255/worker/index.js)

## Context

The API serves token supply and a JSON directory. Adding indicative pricing must
preserve supply consumers and avoid duplicating Inventory's calculations.

## Decision Drivers

- Preserve CoinGecko and CoinMarketCap contracts.
- Keep collection and calculation separate from serving.
- Make pricing failures explicit without affecting supply.
- Explain hosted information and actual network-access interfaces truthfully.

## Considered Options

1. Collect or calculate prices on API requests. Rejected: duplicates Inventory and
   makes provider failures part of serving.
2. Introduce a separate pricing service. Rejected: adds deployment and routing
   maintenance without demonstrated need.
3. Add an isolated published-record reader to the existing Worker. Chosen.

## Decision

Inventory owns the pricing record and calculation. `/api/pricing` serves the exact
validated, committed record published by Inventory to Cloudflare KV, a key-value
store. Pricing requests do not contact providers or recalculate prices. Data updates
do not require API code deployments.

The reader validates record structure, supported versions, revision metadata,
integrity and eligibility before serving. Missing, corrupt, unsupported or expired
native data makes pricing unavailable, not fabricated or indefinitely stale.
Currency-reference expiry is independent: otherwise-valid native data remains
servable with expiry disclosed; dated USD examples must not imply current prices.
Serving and caching never renew observation dates or rewrite the committed record.

Pricing storage access and failures remain confined to the pricing path. Preserve
existing supply and health contracts: URLs, bodies and types, wallet accounting,
rounding, methods, preflight, errors, browser-access headers, caching and last-good
fallback. Keep supply RPC providers and fallback unchanged. Hosting, DNS and the existing
rollback arrangement are unchanged.

Root remains JSON with existing keys and links plus verified descriptions and
documentation. Thin `llms.txt` renders the same descriptions and links, not separately
maintained facts or changing values. Explain hosted information is not an
upload/retrieval gateway; link verified client interfaces without advertising planned
services as live.

Exact storage, HTTP, expiry and validation contracts belong in the specification.

## Consequences

### Positive

- One pricing authority serves multiple consumers without request-time collection.

### Negative / Trade-offs

- Pricing and supply share a deployment; regression protection remains essential.
- KV propagation can delay visibility, and unavailable data leaves pricing unavailable.

### Neutral / Operational

- Retained pricing is not supply's indefinite last-good fallback policy.

## Validation

Compare all supply contracts with the cited baseline. Test pricing-only failures,
absence of provider calls, committed-byte fidelity, version/integrity rejection,
independent expiries, cache limits and root/llms consistency. Verify advertised links.

## Notes for AI-assisted work

AI tools may help draft this ADR, but **must not mark it Accepted without human review**. Accepted ADRs are immutable: create a new superseding ADR rather than editing an Accepted ADR.
