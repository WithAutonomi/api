# API agent rules

- Read `README.md`, `worker/index.js`, `worker/pricing.mjs` and `docs/adr/`
  before changing behavior. The Worker and current endpoint contracts take
  precedence over historical Vercel deployment instructions.
- Preserve supply URLs, bare-number responses, detailed JSON types, wallet
  accounting, rounding, methods/preflight/errors, CORS, caching, provider fallback,
  last-good behavior and health contracts. Pricing is not supply cleanup.
- Inventory owns pricing collection, calculations and authoritative maths tests.
  The API reads one saved envelope with bounded, basic validation; it does not
  execute the model, recompute hashes/examples, validate producer evidence or call
  pricing providers. Valid saved prices and saved currency medians never expire;
  preserve observation, currency, generation and publication dates separately.
  Only pricing accesses pricing storage. Missing or invalid pricing returns 503
  without breaking supply or removing its RPC requests.
- Keep root discovery JSON and thin `llms.txt` on shared descriptions and links.
  Distinguish hosted information from client-run network access. Prepared pricing
  and discovery additions are not verified public availability.
- Build permission is not permission to deploy, change DNS, create resources,
  mutate secrets, incur costs, publish data or accept decisions. Keep credential
  values out of source, fixtures and logs; document secret names only. No laptop
  deploys or personal credentials. The public hostnames serve the same Worker,
  not isolated staging; never use deployment workflows as local verification.
- Follow the approved work packet and the local checks in `README.md`. Run
  `python3 scripts/adr-governance.py` before ADR handoff, reporting its documented
  limits for uncommitted/new drafts. Local success is not CI evidence; ADR CI
  is wired in `.github/workflows/test.yml` but not yet executed. Do not weaken tests or change verification
  mechanisms without explicit approval.
- Keep ADRs Proposed until human acceptance. Put build contracts in specs and
  sequencing in plans; implementation permission is not acceptance or release.

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
