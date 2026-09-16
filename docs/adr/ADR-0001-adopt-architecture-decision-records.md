<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Authored for API using the template from WithAutonomi/adr-standard @ 27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408. See NOTICE. -->

# ADR-0001: Adopt Architecture Decision Records

- **Status:** Proposed
- **Date:** 2026-09-14
- **Decision owners:** Jim Collinson and API maintainers
- **Reviewers:** API maintainers (pending)
- **Supersedes:** none
- **Superseded by:** none
- **Related:** [Pinned team standard](https://github.com/WithAutonomi/adr-standard/tree/27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408); [local guidance](README.md)

## Context

Adding pricing requires durable reasoning about authority and public contracts without
losing the existing supply guarantees.

## Decision Drivers

- Inspectable decisions, shared conventions and human ownership.

## Considered Options

1. Chat and change descriptions: rejected because reasoning scatters.
2. Informal notes: rejected because acceptance remains ambiguous.
3. Pinned team-standard records: chosen without a new dependency.

## Decision

Use the local template and numbered ADR filenames. New decisions remain Proposed
until an authorized human accepts them after engineering review; build permission
and passing checks are not acceptance.

Accepted records are immutable, including status and pointers. A replacement records
`Supersedes:` in its new ADR; never modify the Accepted original.

ADRs hold decisions, alternatives, consequences and validation. Build contracts belong
in specifications; sequencing belongs in plans. Reuse the pinned minimal mechanics,
not optional tools or deployment workflows.

## Consequences

### Positive

- Reasoning and replacement history remain reviewable.

### Negative / Trade-offs

- Human review costs time; automated checks cannot prove approval.

### Neutral / Operational

- Adoption changes no runtime contract and remains Proposed.

## Validation

Review decision coverage and unchanged Accepted records. Use the installed pinned
validator, respecting its documented limits for uncommitted/new drafts. Local
installation and a local pass do not establish CI enforcement or human acceptance.

## Notes for AI-assisted work

AI tools may help draft this ADR, but **must not mark it Accepted without human review**. Accepted ADRs are immutable: create a new superseding ADR rather than editing an Accepted ADR.
