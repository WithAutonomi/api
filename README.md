# Autonomi API

Public supply data for the Autonomi Network Token (ANT), served at **https://api.autonomi.com**. CoinMarketCap and CoinGecko poll the two plain-text endpoints below; anything may read the JSON ones.

Runs as a Cloudflare Worker named `api` (`worker/index.js`) in the Autonomi Cloudflare account. **This repository is the source of truth** — see [How this is deployed](#how-this-is-deployed).

Pricing and `/llms.txt` are prepared additions, not verified public availability.
Root JSON and `/llms.txt` use one shared description/link source, carried forward
from the prior pricing draft. They distinguish this hosted information service
from local antd REST/gRPC clients, MCP tools and direct-network clients. No new
upload, retrieval or MCP endpoint is hosted here.

**Stale-over-error:** if the Arbitrum RPC is unavailable, the supply endpoints serve the last good figure (from in-memory or Cache API fallback) with an `X-Stale: true` header instead of a 500 — a slightly stale number beats an error for CMC/CoinGecko. A 500 only occurs if no figure has ever been computed.

## Endpoint contract

| Endpoint | Content type | Returns |
|----------|--------------|---------|
| `GET /` | `application/json` | Machine-readable index of everything this host serves |
| `GET /api/health` | `application/json` | `{"status":"healthy","service":"ANT Supply API","timestamp":"<ISO>"}` |
| `GET /api/total-supply` | `text/plain` | **Bare integer string**, e.g. `1200000000` |
| `GET /api/circulating-supply` | `text/plain` | **Bare integer string**, e.g. `342278929` |
| `GET /api/supply` | `application/json` | Detailed breakdown (see below) |
| `GET /api/pricing` | `application/json` | Dated Inventory upload-pricing record and diagnostic publication metadata |
| `GET /llms.txt` | `text/plain` | Thin directory of hosted information, local clients and setup links |

The two plain-text endpoints return a bare number with no JSON wrapper — this is the format CoinMarketCap and CoinGecko require and **must not change**. All endpoints send `Access-Control-Allow-Origin: *`. Supply endpoints accept `GET`/`OPTIONS` only (405 otherwise, including `HEAD`).

### Dated upload pricing

`GET /api/pricing` reads binding `PRICING_KV`, key `pricing:v1`, exactly once.
The JSON envelope is `{record, data_revision, payload_sha256, published_at}`.
The record has schema version `1`, kind `upload-pricing-reference` and fixed
calculation version **string** `"2"`. It includes native storage/gas rates, saved
ANT/USD and ETH/USD medians, independent storage/recent-gas/fallback-gas/FX
settings and actual observation windows, gas basis per method, three dated
examples, source dates/URLs, assumptions, exclusions and CLI guidance.

Inventory owns collection, exact arithmetic and example correctness. The API
checks required shapes, supported model identity/parameters, positive decimal
rates, real ordered dates and settings/window relationships. Unknown extra
fields are ignored. It does not execute the model, reproduce aggregation or
coverage evidence, recompute examples/hashes, query Git or call pricing providers.
The revision (40 hex characters), payload hash (64 hex characters) and publication
date describe publication; they are not observation dates or proof of freshness.

Valid network prices and saved FX **never expire**. Averaging durations are not
expiry limits. Keep source data-as-of, saved currency window/sample dates,
generation and publication dates distinct. These are historical estimates from
returned observations, not exhaustive network averages, live quotes or guaranteed
prices. Use `ant file cost <PATH>` for a file-specific estimate, not a guaranteed
final upload price. Independent windows can change without changing the fixed
billing model; old records keep their own dates, settings and explanations.

The entire KV lookup/body read is bounded to two seconds and 65,536 UTF-8 bytes.
Missing binding/key, read failure or invalid data returns
`503 {"error":"pricing_unavailable"}` without touching supply providers.
`OPTIONS` returns 204; other methods return
`405 {"error":"method_not_allowed"}` (`HEAD` has no body). Every pricing response
has `Cache-Control: no-store`, CORS `*`, `X-Content-Type-Options: nosniff` and
Allow/CORS methods `GET, OPTIONS`. No pricing cache, TTL or expiry header is added.
Only the pricing path accesses pricing KV; supply and health retain their original
responses, methods, caches, wallet accounting, RPC order and fallback behavior.

**Not configured for publication:** `wrangler.jsonc` and the deployment workflow
are unchanged. No KV namespace binding/ID, route or secret is added by this work;
without the separately approved binding/data setup pricing returns 503. The two
[API Proposed ADRs](docs/adr/README.md) remain Proposed; local implementation is
not acceptance or release approval.

### Circulating supply definition

`circulating = 1,200,000,000 − Σ(excluded wallet balances)`, read live from the ANT contract on Arbitrum One (`0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684`) via public RPC endpoints (a fallback list in `worker/index.js`, tried in order because public RPCs rate-limit Cloudflare's shared egress IPs), cached for 60 seconds. Excluded wallets:

1. **Network Emissions** — `0xdA4f3aF146f86850DE8e0D6FaE6EEe051Ad0AA44`
2. **MAID Airdrop Wallet** — `0x675D39cdCEA31ba8313565b03D684A3bbe183a1a`
3. **Foundation Cold Wallet** — `0x4f7B7fd0533d06D2ABFad07eAe57C9CE8E92B670`
4. **Foundation Hot Wallet** — `0xd10A556E6A5111b5D4Dd5Ae06761d41F6CE1D499`
5. **Shareholder NFT Contract** — `0x1617C551E1d63e693b0F6B42FE5352a79f2F9961`

Changing this list is a change to the published circulating supply figure — treat it as a reviewed change (PR), and mirror any change in this README.

### `/api/supply` response shape

```json
{
  "total_supply": "1200000000",
  "circulating_supply": "342278929",
  "total_excluded": "857721070",
  "excluded_wallets": [
    { "name": "...", "address": "0x...", "purpose": "...", "balance": "...", "balance_with_decimals": "..." }
  ],
  "timestamp": "<ISO>",
  "decimals": 18,
  "token": { "name": "Autonomi Network Token", "symbol": "ANT", "contract": "0x...", "blockchain": "Arbitrum One" }
}
```

## How this is deployed

- **Config as code.** Worker code, routes, and settings live in this repo (`wrangler.jsonc`). The Cloudflare dashboard is for looking, not editing — dashboard changes are invisible to git and overwritten by the next deploy.
- **Deploys run from GitHub Actions** (`.github/workflows/deploy.yml`) on every merge to `main`, using a scoped Cloudflare API token stored as the repo secret `CLOUDFLARE_API_TOKEN`. No laptop deploys, no personal credentials.
- **Same service, two hostnames**: https://api.autonomi.workers.dev is the same deployed Worker as https://api.autonomi.com, not an isolated staging service. The existing deployment workflow calls it staging and runs public smoke checks; do not use that workflow or either public host as the local pricing gate. `workers.dev` may 403 some non-browser user agents; the production hostname remains the supply contract.
- **Production domain** (`api.autonomi.com`) is declared in `wrangler.jsonc` — enabling/changing it happens via a reviewed commit.

## Secrets

None. The Worker reads public RPC endpoints and holds no credentials. If a secret is ever added, set it via `wrangler secret put` / Actions secrets and document its **name only** here.

## Local checks and development

On Node 22, from a checkout containing the original supply commit:

```bash
node --test tests/pricing.test.mjs tests/supply.test.mjs tests/discovery.test.mjs
npm run bundle:check
git diff --check
```

`npm test` runs the same focused tests. Supply tests read the original Worker at
[`b8c5fb5`](https://github.com/WithAutonomi/api/commit/b8c5fb557049d0163b99c29f23708ec02ced7255)
from local Git and compare exact responses, provider requests, cache effects and
errors against this branch under identical injected I/O. They also check that
supply/health source sections are byte-identical. No public provider is contacted.
The pricing fixture is a byte-for-byte copy of the reduced Inventory `pricing.json`
prepared for this rebuild, preserving the real September 8 rates/dates and original
record provenance. Test envelope metadata is synthetic, not publication evidence.
Tests do not replay historical FX medians or duplicate Inventory's maths suite.

`bundle:check` uses pinned Wrangler **4.127.0** (the existing deployment tooling
version), with metrics disabled, through `versions upload --dry-run`. It only
compiles/checks into ignored `.wrangler/bundle`; it does not upload or deploy.
`npx` may download that tool and its dependencies; no audit-driven upgrades or
runtime dependencies are introduced. Never omit `--dry-run` for validation.

Ordinary no-publish CI is `.github/workflows/test.yml`, job `test`, on pull requests
and main/feature pushes. It requires no Cloudflare credentials and runs these same
checks. CI on the actual branch is green of record; no branch push or CI result is
claimed by local preparation. The existing deploy/public-smoke workflow is unchanged.

Root `AGENTS.md` and the pinned `scripts/adr-governance.py` are installed. Run
`python3 scripts/adr-governance.py` for ADR handoff; its committed-diff checks do not
fully validate uncommitted/new drafts (see `docs/adr/README.md`). ADR CI is wired in
`.github/workflows/test.yml` but not yet executed. Integrated clean-context, adversarial and Craft reviews belong
to the Inventory → API → website checkpoint, not a waiver. Implementation is
prepared, not Done.

Existing interactive development command (not part of the no-publish gate):

```bash
npx wrangler dev          # local simulator on http://localhost:8787
```

## Legacy

`/api/*.js` are the original Vercel serverless functions this Worker replaced (identical behaviour, verified byte-for-byte at migration). They are kept for reference until the Vercel project is retired, then removed.
