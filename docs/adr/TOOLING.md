<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Adapted from WithAutonomi/adr-workbench at 88f34671f0bd1992b086ee8216eca2787c71071a. -->
<!-- Modified for repository-neutral consumer use. See kit/NOTICE in the source distribution; installed as docs/adr/NOTICE. -->
<!-- API adaptation: repository-specific CI integration notes; inherited gate behavior unchanged. -->

# ADR Tooling and AI Harness Setup

Use ADRs as engineering memory, not paperwork. They capture why a decision was made, which
alternatives were rejected, and which consequences the team accepts.

## `adrs` (optional authoring CLI—not required by the gate)

`adrs` is an optional convenience CLI for creating, searching, and checking ADRs. It is not needed
for this baseline: the gate is `scripts/adr-governance.py`, and ADRs can be authored from
`TEMPLATE.md` by hand. Whether to adopt and pin the CLI is a repository decision.

```bash
cargo install adrs   # optional; pin an exact version if the repository standardises on it
```

Useful commands:

```bash
adrs list
adrs search "supersession"
adrs doctor
```

## `adr-kit` (not used by this gate)

Do **not** infer a package dependency from the name of this distribution. The PyPI package named
`adr-kit` is an unrelated third-party tool. The separate `rvdbreemen/adr-kit` project is an
agent-aware toolkit distributed from its own repository. Neither is installed or used by
`scripts/adr-governance.py`; adopting either would require repository-specific evaluation and a
separate decision.

## AI harness guidance

Merge the source distribution's `AGENT-GUIDANCE.md` into each relevant coding-harness profile
without replacing existing repository instructions. Its core rules are:

```text
Before changing architecture, protocols, storage formats, cryptography, network behaviour, public APIs, data models, or operational invariants, inspect docs/adr/.
If the change creates or changes an architectural decision, draft or update a Proposed ADR using docs/adr/TEMPLATE.md.
Never edit an Accepted ADR. Create a superseding ADR instead.
Never mark an ADR Accepted autonomously; that requires human engineering review and debate.
During review, check ADR correctness, rejected alternatives, evidence, consequences, and immutable-Accepted compliance.
```

## Gate scope and limits

The gate is the standard-library script at `scripts/adr-governance.py` from the pinned
team-standard source identified in `README.md`. Repository workflow integration is maintained
separately in `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`; inspect those files
rather than infer CI coverage from this directory. No standalone ADR workflow is installed here.
The script uses a final-diff-oriented, fixed-`docs/adr/` behaviour with a fail-open Git/base
fallback. See `README.md` in this directory for the exact baseline limits. Do not assume
stronger enforcement than documented: stricter discovery and parsing, fail-closed history checks,
symlink rejection, and complete range/event inspection are **not** current behaviour.

## Review standard

Do not "vibe code" ADRs. A useful ADR shows context, options, trade-offs, consequences, evidence,
and validation. AI can help prepare a draft, but humans debate and own the decision.
