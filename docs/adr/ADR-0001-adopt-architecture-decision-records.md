<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Authored for API using the template from WithAutonomi/adr-standard @ 27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408. See NOTICE. -->

# ADR-0001: Adopt Architecture Decision Records

- **Status:** Proposed
- **Date:** 2026-09-09
- **Decision owners:** Jim Collinson and API maintainers
- **Reviewers:** API maintainers (review pending)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** [Team ADR standard, pinned source](https://github.com/WithAutonomi/adr-standard/tree/27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408)

## Context

This API serves supply contracts used by CoinGecko and CoinMarketCap. Adding pricing
creates decisions about data authority, failure isolation and public interfaces.
The README describes current behavior but does not preserve the reasons and rejected
alternatives behind architectural changes.

## Decision Drivers

- Protect established consumer contracts.
- Keep decisions and their evidence inspectable beside the code.
- Preserve human ownership across agent-assisted work.

## Considered Options

1. Rely on chat and change descriptions. Rejected: reasoning becomes scattered.
2. Keep informal notes only. Rejected: acceptance and replacement remain ambiguous.
3. Use the pinned team-standard ADR mechanics locally. Chosen: shared conventions
   without a new package or governance system.

## Decision

Maintain decision records in `docs/adr/` using the local template and numbered
filenames. Architectural changes add or update a Proposed record explaining the
decision, alternatives, consequences and validation.

New records remain Proposed until an authorized human maintainer accepts them after
engineering review. Agent drafts, branch-build permission and successful checks are
not acceptance.

Accepted records are immutable. A replacement records `Supersedes:` in the new ADR;
the old record, including its status and supersession fields, is not edited.

ADRs contain durable decisions, not build specifications or delivery plans. Concrete
contracts and execution details belong in separate linked documents.

## Consequences

### Positive

- Decisions remain reviewable and replacements preserve their history.

### Negative / Trade-offs

- Explicit records require maintenance and human review.
- The inherited validator is a best-effort backstop, not proof of human approval.

### Neutral / Operational

- Existing documented API contracts remain authoritative; adoption does not change them.

## Validation

Run `python3 scripts/adr-governance.py`. Reviewers check decision coverage, rejected
alternatives, evidence and unchanged Accepted records independently of the script's
documented limits in `docs/adr/README.md`.

## Notes for AI-assisted work

AI tools may help draft this ADR, but **must not mark it Accepted without human review**. Accepted ADRs are immutable: create a new superseding ADR rather than editing an Accepted ADR.
