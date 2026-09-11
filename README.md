# Autonomi API

Token supply, storage-cost estimates, and information about the APIs and tools for accessing Autonomi.

The existing supply endpoints are served at **https://api.autonomi.com**. Pricing and expanded discovery are branch implementations, not yet deployed. CoinMarketCap and CoinGecko poll the two plain-text supply endpoints below; anything may read the JSON ones.

Runs as a Cloudflare Worker named `api` (`worker/index.js`) in the Autonomi Cloudflare account. **This repository is the source of truth** — see [How this is deployed](#how-this-is-deployed).

**Stale-over-error:** if the Arbitrum RPC is unavailable, the supply endpoints serve the last good figure (from in-memory or Cache API fallback) with an `X-Stale: true` header instead of a 500 — a slightly stale number beats an error for CMC/CoinGecko. A 500 only occurs if no figure has ever been computed.

## Endpoint contract

| Endpoint | Content type | Returns |
|----------|--------------|---------|
| `GET /` | `application/json` | Machine-readable index of everything this host serves |
| `GET /api/health` | `application/json` | `{"status":"healthy","service":"ANT Supply API","timestamp":"<ISO>"}` |
| `GET /api/total-supply` | `text/plain` | **Bare integer string**, e.g. `1200000000` |
| `GET /api/circulating-supply` | `text/plain` | **Bare integer string**, e.g. `342278929` |
| `GET /api/supply` | `application/json` | Detailed breakdown (see below) |

The two plain-text endpoints return a bare number with no JSON wrapper — this is the format CoinMarketCap and CoinGecko require and **must not change**. All endpoints send `Access-Control-Allow-Origin: *`. Supply endpoints accept `GET`/`OPTIONS` only (405 otherwise, including `HEAD`).

`/api/health` checks whether this API service is responding. It does not check the
Autonomi network or the freshness of supply or pricing data. Its existing payload,
including `service: "ANT Supply API"`, is unchanged.

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
- **Staging**: every deploy also serves at https://api.autonomi.workers.dev (note: `workers.dev` sits behind Cloudflare bot protection and may 403 some non-browser user agents; the production hostname is the contract). CI also runs a public-contract test against `api.autonomi.com`, including automation user-agents, so a zone bot-protection change that would block machine clients fails the build.
- **Production domain** (`api.autonomi.com`) is declared in `wrangler.jsonc` — enabling/changing it happens via a reviewed commit.

## Secrets

None. The Worker reads public RPC endpoints and holds no credentials. If a secret is ever added, set it via `wrangler secret put` / Actions secrets and document its **name only** here.

## Local development

```bash
npx wrangler dev          # local simulator on http://localhost:8787
```

## Testing

With Node **22.22.3**, run `node --test tests/*.test.mjs`, then
`python3 scripts/adr-governance.py` for decision-record validation. No dependency
installation is needed for these checks. The tests import the actual Worker
with controlled RPC, Cache API and clock fixtures; they make no real network
calls. Fixtures are synthetic, never deployment data. Node's typeless-module
warning is expected with the existing package configuration. The new deadline
test also uses Node's built-in MockTimers API, which reports an experimental
warning on this pinned Node version; neither warning is suppressed.

These are preservation tests, not new supply policy: they record current method,
rounding, provider and stale-cache behavior, including malformed-reply quirks and
cache failures that can still return 500. They exercise the Worker directly, not
Cloudflare's HTTP transport (which may strip a HEAD response body).
`.github/workflows/ci.yml` runs the checks read-only for the pricing feature
branch and pull requests, with no deployment or cloud credentials. The existing
deployment workflow runs the same checks before deploying and retains its live
post-deployment probes; offline tests do not replace those probes.

## Pricing reader and discovery — branch implementation, not yet deployed

The [pricing contract](docs/specs/pricing-api.md) adds two routes to this same
Worker. This branch is **not deploy-ready**: no approved pricing namespace ID
has been supplied, and `wrangler.jsonc` is unchanged. There is no dummy binding,
created resource or published pricing record in this work.

Upload-cost estimates for adding data to Autonomi, including storage fees and
network transaction costs. These are not live quotes or guaranteed prices. For a
file-specific estimate, use the Autonomi CLI or another supported client tool.
See [CLI file-specific cost estimates](https://docs.autonomi.com/developers/cli/command-reference)
or [Local REST API cost estimates](https://docs.autonomi.com/developers/sdk/install/reference/rest-api.md).
The REST interface runs through your local antd, not this hosted API.

| New route | Behavior once deployed |
|-----------|------------------------|
| `GET /api/pricing` | Exact validated Inventory JSON bytes, or `503 {"error":"pricing_unavailable"}` |
| `GET /llms.txt` | Short plain-text directory rendered from the same descriptions and links as root JSON |

Pricing accepts `GET` and `OPTIONS` (204, empty). Other methods return 405;
HEAD has no body. Failures and non-GET responses use `Cache-Control: no-store`.
The route alone reads `env.PRICING_KV`, once, at fixed key `pricing:v1`, as a
stream with KV `cacheTtl: 60`. Read plus stream consumption has a 2-second total
deadline, a 65,536-byte value limit and a 1,024-byte metadata limit. Missing or
broken storage cannot disable root, health, supply or the directory.

The reader checks strict UTF-8, canonical JSON, the complete supported production
record, publication metadata and SHA256 before returning the original bytes.
It makes no pricing-provider/RPC queries, calculates no prices and keeps no
last-good pricing cache. Inventory's independent verification owns evidence and
price/example recomputation; the API's hashes detect corruption, not dishonest
authorized publication or globally current KV visibility.

Successful responses expose these browser-readable headers:

- `X-Pricing-Revision`: the data commit, not the original producing code commit.
- `X-Pricing-SHA256`: SHA256 of the original decoded JSON bytes.
- `X-Pricing-Published-At`: publication time, **not a renewed observation date**.
- `X-Pricing-Native-Expires-At`: seven days after original `source.data_as_of`.
- `X-Pricing-Reference-State`: `valid` or `expired`.
- `X-Pricing-Reference-Expires-At`: 48 hours after the recorded currency window end.

Native expiry makes the route unavailable. Currency expiry alone does not:
the original record and its dated examples remain unchanged. **Never use expired
reference exchange rates or USD examples as current USD prices.** An independent
eligible live conversion may still use the valid native rates. Both expiries are
inclusive; eligibility is checked again after the read. HTTP caching is at most
60 seconds, shortened to the next relevant expiry, with `must-revalidate` and no
stale allowance. Conditional request headers do not enable 304 responses.

Root retains every existing entry, link, header and method behavior, adding
pricing, llms, an overview, client interfaces and labelled documentation. It and
`llms.txt` use the single `DISCOVERY` object in `worker/index.js`; neither reads
KV or fetches providers. Root links use the request origin for local exercises;
the prose directory links hosted routes at the canonical production origin.
The directory holds no changing prices, tool/version counts or installer commands.
New `llms.txt` methods are GET/OPTIONS (204 preflight), otherwise 405 with
`Method not allowed` (HEAD empty); its one-hour GET cache does not alter root rules.

### Vendored source and offline checks

Only the platform-neutral record validator and model are copied from
[Inventory's reviewed revision 07fa880](https://github.com/WithAutonomi/inventory/commit/07fa880e2600bb5b2e2156f2b5ed87654f25e5f9).
`worker/pricing/origin.json` records the exact source paths, revision and SHA256s.
Do not edit those copies independently or import sibling checkouts. No collector,
private evidence or Node filesystem/network code is shipped by the Worker.
The shared model supplies fixed example-summary validation, not request-time
monetary calculations.

The existing `node --test tests/*.test.mjs` command picks up the new pricing,
discovery and source-origin suites alongside all 139 retained preservation
cases, with two owner-approved root-name assertion changes.
`tests/pricing-fixtures.mjs` contains **invented test-only** rates, dates and
identities; it is never imported by deployed code. Tests use explicit KV
streams, fake clocks and controlled provider/cache fixtures, without cloud
credentials, a sibling repository, collection or publication. CI commands,
deployment workflow, package behavior and legacy Vercel files are unchanged.

### Review notes and remaining gates

- **Copy is draft, not Jim-approved final wording.** Review the new overview,
  pricing explanation and client guidance in `DISCOVERY`. They distinguish hosted
  information from local antd, daemon-backed SDK/MCP clients and direct ant/ant-core
  network access. Link destinations and those distinctions come from the
  [2026-09-09 verified-documentation preflight](https://github.com/WithAutonomi/developers/blob/feat/pricing-widget-v1/planning/research/pricing-launch-preflight-2026-09-09.md#verified-interface-documentation-links),
  not a new live check or successful installation claim. Recheck links/content
  before final publication; this implementation makes no live requests.
- **Binding setup requires separate approval.** Obtain the actual approved KV
  namespace ID, then add a reviewed `PRICING_KV` binding to this Worker in
  `wrangler.jsonc`. It must identify the same namespace used by Inventory's
  separately approved publisher. This change supplies no namespace ID and
  creates/configures no resource; until setup/publication, pricing returns 503.
- The proposed decisions still need human resolution; independent reviews and
  exact-candidate CI belong to the orchestrator before unit closure. Local tests
  are not the CI green of record or permission to deploy. CI status is reported
  by the feature branch's [CI workflow](https://github.com/WithAutonomi/api/actions/workflows/ci.yml).
- Deployment, first verified publication, unchanged-supply public probes and
  pricing revision/hash visibility remain later owner-approved release actions.
  `workers.dev` and production are the **same Worker**, not isolated staging.
  No public availability, actual collection or successful daily refresh is claimed.

## Legacy

`/api/*.js` are the original Vercel serverless functions this Worker replaced (identical behaviour, verified byte-for-byte at migration). They are kept for reference until the Vercel project is retired, then removed.
