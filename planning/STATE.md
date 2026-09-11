# API pricing build state

Updated: 2026-09-10.

## Current position

- Worktree: `/Users/jimcollinson/code/developers/.worktrees/api-pricing`; branch `feat/pricing-publication-v1`; base `b8c5fb557049d0163b99c29f23708ec02ced7255`.
- Mode: attended. Jim explicitly approved building the complete pricing feature and supply-preservation checks on isolated branches, with no deployment, activation, existing supply-calculation change or new cost.
- Coordination plan: Developers worktree `planning/pricing-launch-plan.md`; unit1 contract/supply safety baseline and Inventory unit2 collector/evidence are complete. Unit4 isolated pricing reader/discovery is implemented and committed on this feature branch, not deployed. Remaining review, runtime and actual binding setup gates are listed below.
- Unit1 committed/pushed head: `68a7e3decfc1bc2e00d48d4c0c77a9200f98d2b9`. [CI34391398044](https://github.com/WithAutonomi/api/actions/runs/34391398044) passed139tests and ADR checks. This was the read-only feature CI lane, not deployment. Existing Worker/legacy/runtime config/package/supply behavior remains unchanged.
- Unit1 reviews: standard **passed**, verifier **12/12passed**, adversarial **READY-WITH-NITS** (stale handoff LOW corrected by current checkpoint), Craft **PASS/zero findings** after exact-diff inspection. Same-provider independence is weaker. All new ADRs remain Proposed. Coordinator checkpoint: Developers `planning/reviews/pricing-launch-01.md`, with all three exact candidate/CI records.
- Unit4 core candidate **b71dfd3bc72cfdec5a1defd5fe624a3d2182e2b4** is committed/pushed; [CI34504155895](https://github.com/WithAutonomi/api/actions/runs/34504155895) passed155tests/governance at that exact revision. Standard review passed for the reader and later copy. All139supply cases are retained, with only the two owner-approved root-name assertion changes; actual health/supply behavior and configuration remain unchanged. Read the current branch's CI for any subsequent commit rather than treating this historical green as evidence for different bytes.
- Owner copy continuation is implemented and focused standard review **passed**: shared **Autonomi API** title; overview and pricing description say **upload-cost estimates**, not dated references or a private producer name; health explains service responsiveness only. Two labelled CLI/local-REST estimate guides use the existing shared documentation list. Root retains its llms link, while llms omits its own listing. Technical expiry/current-USD restrictions remain in README/spec and existing assertions. Coordinator's public root GET confirmed the original four descriptions verbatim; published cost-guide GETs returned200 and documented file/data estimation, not an actual tool run. Reviewer `ses_f7430a772ffejVRU0f7q9oKG3Q` independently ran155tests, governance, syntax/whitespace and protected comparisons. Same-provider independence is weaker. No new test cases, schema/renderer/runtime changes, commit/push, deployment or unit-completion claim in this continuation.
- Unit4 goal verifier **passed10/10 bounded implementation goals**, independently running155tests, governance,13syntax checks, source-Git-object vendor comparison and offline baseline/discovery/isolation exercise. No implementation gap found. Full verifier report is in coordinator `planning/phases/pricing-launch-04/VERIFICATION.md`.
- Adversarial review of b71dfd3: **READY-WITH-NITS**, no blocking code finding. Two LOWs concerned stale state and successful fragmented-stream test coverage. This state correction and a nine-line extension to the existing successful-read case address them without runtime changes or new cases.155tests still pass locally; obtain follow-on exact-candidate CI/review and Craft before the next code checkpoint. README now accurately says139retained cases, not wholly unchanged assertions.
- Retained gates: actual binding configuration, pinned Cloudflare runtime exercise (Wrangler not locally available), integrated producer/API/website proof, dedicated clean-context review, final copy/decision resolution and approved release checks. No installation/configuration permission follows from code approval. Unit4 is not Done, PR-ready or deployed; source-only greens do not discharge these gates. Coordinator `planning/reviews/pricing-launch-04.md` records the latest exact-candidate review/CI evidence.
- Preserve existing supply logic, wallet list, provider fallback, caches, response formats, methods/errors/preflight and health. Root may later gain additive discovery content; no hosting/DNS changes or Vercel cleanup.
- No cloud resource, secret or namespace binding ID has been created/configured. Do not guess an ID, reuse deployment credentials for publishing, or claim account-scoped KV tokens are namespace-limited.
- Do not open a partial PR. The final package is coordinated with Inventory and Developers for one owner/Hermes review; actual PR/merge/production actions remain checkpoints.

## Baseline evidence

Node22.22.3 directly imported the unchanged Worker and observed total-supply GET200 with bare1200000000, OPTIONS200 with empty body, HEAD405 with Method not allowed. This was a small read-only baseline, not a complete suite. Its typeless-module warning was not suppressed by changing package behavior. No provider request or production change occurred.

## Gates

- Unit1code/verifier/adversarial/Craft and exact-candidate CI complete; no waiver. Later runtime units need their own reviews. Integrated clean-context remains required; no full feature/PR/production readiness claim.
- No project `.gsd/gate.sh`; no gate is to be generated during execution.
- CI additions are explicitly in this approved mechanism work unit; preserve the existing deployment target/events/credentials and never deploy from the new feature-branch CI lane.
- ADR acceptance is human-only. Keep all new records Proposed and preserve original project files outside the approved scope.
