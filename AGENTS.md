# API agent rules

- Read `README.md`, `worker/index.js`, `wrangler.jsonc` and `docs/adr/` before
  changing behavior. The Worker and current endpoint contracts take precedence
  over historical Vercel deployment instructions.
- Preserve supply URLs, bare-number responses, detailed JSON types, wallet
  accounting, rounding, methods/preflight/errors, CORS, caching, provider fallback,
  last-good behavior and health contracts. Pricing work is additive, not supply cleanup.
- Inventory owns pricing data and calculations. The API only validates and serves
  the published record. Access pricing storage only on the pricing path; missing
  pricing configuration must not break supply. Do not remove supply RPC requests
  under the pricing-only prohibition on provider lookups.
- Keep root discovery JSON and thin `llms.txt` on shared descriptions and links.
  Verify capability and documentation claims; distinguish hosted information from
  client-run network access. Do not advertise unimplemented routes as live.
- Build permission is not permission to deploy, change DNS, create resources,
  mutate secrets, incur costs, publish data or accept decisions. Follow the approved
  work packet; stop for separate approval at those boundaries. Keep credential
  values out of source, test fixtures and logs. Preserve the current rollback arrangement.
- Run `python3 scripts/adr-governance.py` before ADR handoff. CI and tests are
  separately reviewed mechanisms, not settings to weaken to obtain a pass.
- Write ADRs in plain language, aiming for 500 words or fewer. Put concrete build
  contracts in specs and sequencing in plans.

<!-- Exact eligible standard fragment follows, merged unchanged. Source: https://github.com/WithAutonomi/adr-standard @ 27c8ffb5790d99f3f042c68e4e5d4b8fa8bad408. -->
<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->
<!-- Adapted from WithAutonomi/adr-workbench at 88f34671f0bd1992b086ee8216eca2787c71071a. -->
<!-- Modified for repository-neutral consumer use. See NOTICE in this source distribution and docs/adr/NOTICE after installation. -->

## Architecture Decision Records

Before changing architecture, protocols, storage formats, cryptography, network behaviour, public
APIs, data models, or operational invariants, inspect `docs/adr/`.

If the change creates or alters an architectural decision, draft or update a **Proposed** ADR using
`docs/adr/TEMPLATE.md` and the `ADR-NNNN` filename convention.

Never edit an Accepted ADR; create a superseding ADR instead. Never mark an ADR Accepted
autonomously: acceptance requires human engineering review and debate.

During review, check ADR correctness, rejected alternatives, evidence, consequences, and
immutable-Accepted compliance. See `docs/adr/TOOLING.md` for authoring guidance and the review
standard.
