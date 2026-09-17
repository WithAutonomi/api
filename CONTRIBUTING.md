# Maintain and contribute to Autonomi API

For what this service provides and how to use it, see the [README](README.md).
This guide covers working on the service without changing its public contracts
or accidentally deploying to production.

## Local development and checks

Use Node 22, matching CI, and a checkout with full Git history. Supply tests read
the original Worker from [commit b8c5fb5](https://github.com/WithAutonomi/api/commit/b8c5fb557049d0163b99c29f23708ec02ced7255)
to compare behaviour. A shallow checkout may not contain that commit.

```bash
npm test
npm run bundle:check
git diff --check
```

Tests cover pricing, shared root/llms guidance and preservation of supply/health
responses, provider requests, caches and fallbacks. They use injected inputs,
not public providers. The pricing fixture retains real September 8 observations;
its publication metadata is synthetic. It is not a live availability check, a
replay of historical currency medians or a second authoritative calculation suite.

`bundle:check` uses pinned Wrangler 4.127.0 with metrics disabled and
`versions upload --dry-run`. It compiles into ignored `.wrangler/bundle` output;
it does not upload or deploy. `npx` may download the pinned tool and dependencies.
Never omit `--dry-run` when running the bundle check.

For interactive local development:

```bash
npx wrangler dev
```

The local simulator normally uses `http://localhost:8787`. `npm run dev` still
points at the legacy Vercel tool; use Wrangler instead. Local pricing returns
503 unless its storage contains a valid record. Local supply requests may contact
public blockchain providers; unlike the tests, interactive development is not
an offline check. Do not use the production deployment workflow as a local test.

## Review and CI

Open a pull request for changes. `.github/workflows/test.yml` runs the tests,
bundle check, ADR checker and whitespace check on pull requests and pushes to
`main` and `feat/**`. These checks require no Cloudflare credentials and do not
deploy. CI on the proposed revision is the authoritative check result; local
success does not replace it.

Follow [AGENTS.md](AGENTS.md) and the [ADR guidance](docs/adr/README.md) before
changing architecture or operational contracts. For decision-record changes:

```bash
python3 scripts/adr-governance.py
```

The checker uses committed differences; uncommitted/new drafts may not receive
full structural checking. Keep proposals Proposed until human acceptance, and
never edit an Accepted decision to change it. Review and release approval are
separate from passing tests.

## Hosting and deployment

The service runs as the Cloudflare Worker `api`, not on Vercel. Its source is
`worker/index.js`; `wrangler.jsonc` declares the bindings and production domain.
Configuration belongs in Git, not dashboard edits that the next deploy overwrites.

Every merge to `main` deploys through `.github/workflows/deploy.yml`, using the
repository's `CLOUDFLARE_API_TOKEN` secret. Do not deploy from a laptop or use
personal credentials. Document secret names only, never their values.

https://api.autonomi.workers.dev and https://api.autonomi.com serve the same
Worker, not isolated environments. The deployment workflow calls the former
"staging" and runs public smoke checks; that label does not make it safe for
experiments. The provider hostname may reject some non-browser user agents.

The running Worker has no API credentials. It reads public blockchain RPC
providers and the `PRICING_KV` binding. The deployment token belongs to Actions,
not the request-handling code.

The retained `/api/*.js` files are historical Vercel implementations. They are
not the current deployment entry point. Their presence does not establish whether
the old Vercel project has been retired; verify that separately before cleanup.

## Pricing publication and serving

[Inventory](https://github.com/WithAutonomi/inventory) is the private publishing
repository; organisation access is needed to maintain it, not to consume this API.
It owns collection, full record validation, exact calculation and examples.
It commits and pushes the validated `pricing.json` before writing one envelope
to key `pricing:v1` in the approved namespace bound as `PRICING_KV`.

The publisher is separate from this Worker and uses its own credentials and
activation controls. [Initial live activation](https://github.com/WithAutonomi/api/pull/5#issuecomment-5701339268)
was verified on September 16, 2026. Do not infer current freshness from that
checkpoint: inspect the record's observation dates and the publisher's runs.

The Worker reads one envelope `{record, data_revision, payload_sha256, published_at}`
with a two-second/65,536-byte limit. Its reader checks:

- Envelope/record objects, `schema_version: 1`, `kind: "upload-pricing-reference"`
  and `calculation.calculation_version: "2"`.
- Four native-currency rates and two saved USD rates: positive decimal strings,
  at most 24 integer and 24 fractional digits, without coercion or exponent notation.
- `source.data_as_of`: a valid UTC calendar string with optional three-digit
  milliseconds; `exchange_reference.window_end`: positive safe-integer Unix
  milliseconds representing a valid date. Neither may exceed now by 60 seconds.

Valid saved rates never expire. Return the saved envelope unchanged; do not
recompute examples or hashes, execute the model, query Git or call pricing
providers. Diagnostic metadata, unused descriptive fields and cosmetic changes
do not gate availability. Keep observation, currency, generation and publication
dates distinct. Unknown fields are permitted.

Only the pricing path accesses pricing storage. Missing binding/key, read failure
or invalid data returns `503 {"error":"pricing_unavailable"}` without touching
supply providers. `OPTIONS` returns 204; other non-GET methods return 405 with
`{"error":"method_not_allowed"}` (`HEAD` has no body). Pricing responses carry
`Cache-Control: no-store`, CORS `*`, `X-Content-Type-Options: nosniff` and
Allow/CORS methods `GET, OPTIONS`.

## Preserve existing contracts

Keep root JSON and `/llms.txt` on the shared descriptions and links in
`worker/index.js`, consistent with the README. Distinguish this information
service from client-run network access. Do not promise reserved CLI quotes or
equate new publication dates with fresh observations.

Preserve supply URLs, bare-number responses, JSON types, rounding, wallet
accounting, provider fallback, caching, method handling and CORS. Changing excluded
wallets changes published circulating supply; review it explicitly and update
the README's definition at the same time.

The health response retains `"service": "ANT Supply API"` as an existing contract,
not as the full description of this service. Preserve root's existing method and
header behaviour too; discovery improvements are not endpoint cleanup.
