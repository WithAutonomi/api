<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Adapted from WithAutonomi/adr-workbench at 88f34671f0bd1992b086ee8216eca2787c71071a. -->
<!-- Modified for repository-neutral consumer use. See kit/NOTICE in the source distribution; installed as docs/adr/NOTICE. -->
<!-- API adaptation: pinned-source provenance and repository-specific CI integration notes; inherited gate behavior unchanged. -->

# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for this repository. An ADR captures
a significant decision — its context, the options considered, the choice, and its consequences —
in a short document beside the code it shapes. A record evolves while it is Proposed; once
Accepted it is never rewritten — when a decision changes, a new record supersedes the old one, so
the trail of what was decided, and why, stays legible to people and AI agents alike.

## Source and local integration

Mechanics come from [WithAutonomi/adr-standard at
27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408](https://github.com/WithAutonomi/adr-standard/tree/27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408),
using the installed Inventory copy. The template, validator, licensing notices and eligible
agent-guidance fragment are unchanged; this README and TOOLING adapt the integration notes.
No third-party package or `.adr-kit.yaml` is required by this baseline.

CI integration is maintained separately in this repository's workflows. Consult
`.github/workflows/ci.yml` and `.github/workflows/deploy.yml` for actual events and ordering.
Installing ADR files alone does not establish CI enforcement; no standalone
`adr-governance.yml` is installed here.

## How this works

1. Copy [`TEMPLATE.md`](./TEMPLATE.md) to the next `docs/adr/ADR-NNNN-short-title.md`.
2. Keep the status **Proposed** while the decision is developed, discussed, and reviewed.
3. Run the gate: `python3 scripts/adr-governance.py`. With a usable base it checks Accepted
   records changed against that base — a best-effort backstop with documented limits.
4. This repository's authorised human accepts or rejects the decision — acceptance is a human
   act, never a tool's or an agent's.
5. Never edit an Accepted ADR; create a new superseding ADR instead.

## Rules

1. Use `ADR-NNNN-short-title.md` names with four-digit numbers.
2. New ADRs start as **Proposed**.
3. **Accepted** ADRs are immutable. If a decision changes, create a **new** ADR that records
   `Supersedes:` the old one; supersession is forward-only and the old Accepted record is not
   edited.
4. Architectural changes add or update an ADR before merge.
5. Reviews check correctness, evidence, trade-offs, and compliance—not just presence.
6. Acceptance is a human gate and is never inferred or performed by this tooling.

The template still carries an old-side `Superseded by:` field that cannot be filled after
acceptance without violating immutability. This baseline records the contradiction and does not
resolve it.

## Template

Use [`TEMPLATE.md`](./TEMPLATE.md).

## Tooling

See [`TOOLING.md`](./TOOLING.md) for authoring and AI-harness guidance.

## What the governance gate actually does

With a usable base, the script validates only the final diff's existing
`docs/adr/ADR-*.md` paths changed against that base; without a base it validates all
discovered ADRs. Duplicate-number checking always considers all discovered ADRs.
Uncommitted edits and untracked new files are not part of that committed diff.

The gate checks the filename convention, an allowed status value, required sections, duplicate
numbers, and whether a changed file was Accepted at the selected base. It does not enforce lifecycle
transitions, human identity, or supersession. Files outside the fixed `docs/adr/ADR-*.md` discovery
pattern are not validated. Git/base failures can fail open, the canonical directory may be reached
through symlinks, and the gate and workflow can be modified in the same change they inspect.
Duplicate-number detection keys
`ADR-NNNN.md` and `ADR-NNNN-short-title.md` differently, so a bare-numbered file and a titled file
sharing a number can coexist undetected.

These are known limits of this baseline, not promises of stronger enforcement.
