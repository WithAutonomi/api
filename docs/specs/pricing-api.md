# Pricing API — isolated reader and discovery contract

Status: implementation contract for the approved pricing launch, 2026-09-09; not a live endpoint or deployment claim. Implement inside the existing Worker, not a new host/service. [ADR-0001: Adopt Architecture Decision Records (API)](../adr/ADR-0001-adopt-architecture-decision-records.md) and [ADR-0002: Serve Inventory pricing while preserving supply contracts (API)](../adr/ADR-0002-serve-inventory-pricing-while-preserving-supply-contracts.md) are prepared separately and remain Proposed; human acceptance/setup/deployment gates still apply.

The [Inventory production contract](https://github.com/WithAutonomi/inventory/blob/feat/pricing-reference-v1/docs/specs/pricing-production.md) owns record/evidence/metadata validation; the [website contract](https://github.com/WithAutonomi/developers/blob/feat/pricing-widget-v1/docs/specs/pricing-production-consumption.md) owns presentation. [Pricing launch — complete three-repository delivery](https://github.com/WithAutonomi/developers/blob/feat/pricing-widget-v1/planning/pricing-launch-plan.md) owns sequencing and permissions. Branch links identify coordinated candidate documents, not deployed evidence.

## 1. Route and isolation

Target: [https://api.autonomi.com/api/pricing](https://api.autonomi.com/api/pricing). Preserve current trailing-slash normalization; query parameters neither change the KV key nor select a provider/version. No request-body processing. Read binding `env.PRICING_KV` **only after routing a pricing GET**. Missing binding, invalid storage or pricing exceptions must not fail module initialization, health, root, supply, or unknown-route behavior.

One `getWithMetadata('pricing:v1', {type: 'stream', cacheTtl: 60})` per pricing GET, no list operation, retry or provider fetch. Impose a **2,000 ms total deadline** over KV read and stream consumption; a deadline race must return even if transport ignores cancellation. Cancel the stream on failure without waiting for a stalled cancellation. At most **65,536 value bytes** and **1,024 metadata bytes**; stop reading on excess. No pricing Cache API layer, in-memory last-good price or supply-style indefinite stale fallback. KV's own bounded cache/eventual consistency is not proof of globally current publication.

Read exact bytes, validate metadata/hash, strict UTF-8 and canonical JSON (two-space `JSON.stringify` plus one LF; no BOM, duplicate keys or extra bytes), then validate structure and dates. Return those **same bytes**, not a reconstructed JSON object. Never fetch ant.report, CoinGecko, GitHub, a currency service or a supply RPC on this path. Do not calculate rates, upload costs or new examples in the Worker.

## 2. Supported record and integrity checks

Accept only schema number `1`, kind `indicative-upload-pricing`, exact model-2 metadata (calculation version string `"2"`) and `source.provenance: "production-daily-v1"`. Do not accept the legacy local-only capture simply because its model is compatible. Enforce the complete field/type/length/array constraints in Inventory sections 2–3, with no unknown production fields. In particular:

- `source` has the reviewed fixed ant.report name, request/formula URLs/hash/window; canonical source times; production main/repository identity, schedule/dispatch event, attempt `"1"`, bounded run id and source/evidence hashes.
- All `MODEL` parameters/units/client identifiers match, not just the version label. All four native rates and both reference exchange rates are positive bounded decimal **strings**, never coerced Numbers/null/zero.
- Both storage and selected gas aggregates have bounded unsigned totals/counts, positive billed activity, full gas coverage and valid ordered windows/active subsets. Daily windows use 86400-second buckets and a latest-minus-604800 cutoff. Hourly windows use 3600-second buckets and latest-minus-86400 cutoff. Bucket bounds follow Inventory; no invented dense time-series requirement.
- `recent-day-hourly` gas has positive `recent_day_billed_units` equal to its selected units; `seven-day-daily-fallback` requires zero recent units and selected aggregate/window equal to that method's storage reference. Storage single/batch windows match. Count and window consistency checks are validation, not pricing recalculation.
- Reference method/source/URLs, 24-hour window, exact 48-hour expiry, two sample summaries (200–400 points, at most 15-minute gaps, boundary coverage and span consistency) and rates are structurally valid **even when expired**. Malformed reference data rejects the whole record; mere elapsed reference expiry does not.
- Exactly three examples, 1 MB/GB/TB in that order, with the existing complete summary, native and USD fields: counts canonical unsigned strings, method/billing unit matched, batch summary null for single or the existing three typed fields for batch; native decimals at most 64 characters, USD decimals at most 256. No null/missing total. Fixed normalization/assumptions/limits follow Inventory, including the production rather than local-only limit. CI in Inventory, not this route, recomputes their arithmetic.

Metadata is the exact nine-key object from Inventory: `schema_version`, `data_revision`, `payload_sha256`, `evidence_sha256`, `producer_revision`, `verifier_revision`, `publication_run_id`, `publication_run_attempt`, `published_at`. Validate types/patterns, including metadata version number `1`, attempt string `"1"`, 40-character lowercase revisions, 64-character lowercase hashes, and canonical millisecond publication date. Require:

1. SHA256 of the original value bytes equals `payload_sha256`;
2. `evidence_sha256 = body.source.capture.sha256`;
3. `producer_revision = body.source.capture.head_sha`;
4. `generated_at <= published_at <= now + 60000`, plus the native chronology below.

`data_revision` is the verified data commit D, not the source-code commit in the body. `verifier_revision` identifies the checked code at C; rollback may have a different original producer. API does not contact Git to prove ancestry or read private evidence. Publication's independently verified D handoff establishes those relationships; hash headers are not signatures or proof against a malicious authorized writer.

## 3. Freshness and HTTP contract

Use a positive safe integer current millisecond clock. Reject invalid clocks. Native time rules: `data_as_of <= provider_generated_at <= generated_at`, capture/metadata times `<= generated_at`, all these times no more than 60,000 ms into the future. Define `N = Date.parse(source.data_as_of) + 604800000`; native is eligible at `now <= N`, expired at `N + 1`. Define `R = exchange_reference.expires_at = window_end + 172800000`; require `window_end <= now`. Reference state is `valid` at `now <= R`, otherwise `expired`. Recheck eligibility after the bounded read/validation, immediately before response creation.

| Request/result | Status and exact body | Storage access / caching |
| --- | --- | --- |
| Valid GET, including reference-expired/native-valid | `200`, original committed JSON bytes | One bounded KV read; success cache below |
| Missing binding/key/metadata, read failure/deadline, corrupt/oversize/unsupported/malformed body, invalid chronology or native expired | `503`, `{"error":"pricing_unavailable"}` (no LF) | Never a provider fallback; `Cache-Control: no-store` |
| OPTIONS | `204`, empty | No KV; `Cache-Control: no-store` |
| Any other method, including HEAD | `405`, `{"error":"method_not_allowed"}` (no LF); HEAD has no response body | No KV; `Cache-Control: no-store` |

All pricing responses carry these exact application headers (header names are case-insensitive):

```text
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type
Allow: GET, OPTIONS
X-Content-Type-Options: nosniff
Access-Control-Expose-Headers: X-Pricing-Revision, X-Pricing-SHA256, X-Pricing-Published-At, X-Pricing-Native-Expires-At, X-Pricing-Reference-State, X-Pricing-Reference-Expires-At
```

Only successful GET adds:

| Header | Value |
| --- | --- |
| `X-Pricing-Revision` | Metadata `data_revision` |
| `X-Pricing-SHA256` | Metadata `payload_sha256`, bare lowercase hex |
| `X-Pricing-Published-At` | Metadata publication timestamp |
| `X-Pricing-Native-Expires-At` | Canonical UTC millisecond date for N |
| `X-Pricing-Reference-State` | `valid` or `expired` |
| `X-Pricing-Reference-Expires-At` | Canonical UTC millisecond date for R |

Success `Cache-Control` is exactly `public, max-age=T, must-revalidate`, with integer `T = max(0, min(60, floor((B - now) / 1000)))`; B is `min(N, R)` while reference is valid, otherwise N. At a boundary/subsecond remainder T is zero. No stale-while-revalidate, stale-if-error, `X-Stale`, ETag/304 handling, content negotiation or negative HTTP caching. Ignore conditional request headers and return the normal validated 200/503. Platform-added Date/content-length/compression headers are outside the application contract; payload hash covers decoded representation bytes, not HTTP compression.

Expired reference remains **in the unchanged body**, including its dated examples; the header and documentation explicitly forbid treating them as current USD. Fresh live conversion may still use valid native rates. A serving/publication timestamp never renews observation dates. Fixed 503 hides provider/storage details; no arbitrary exception text, raw record or secrets in pricing logs. No credentials CORS, origin reflection or new auth requirement.

## 4. Existing supply contracts — protected baseline

Authority: [Worker at b8c5fb5](https://github.com/WithAutonomi/api/blob/b8c5fb557049d0163b99c29f23708ec02ced7255/worker/index.js), not claimed ideal parity with legacy Vercel functions. Keep the entire current behavior, including imperfect inputs/fallbacks; adjacent fixes need separate scope.

| Route | Protected behavior |
| --- | --- |
| `/api/total-supply` | GET 200 bare text `1200000000`, no JSON wrapper/newline; `public, max-age=3600` |
| `/api/circulating-supply` | GET 200 bare integer string, `public, max-age=60`; no-fallback failure 500 text `Error calculating circulating supply` |
| `/api/supply` | GET 200 detailed JSON, `public, max-age=60`; failure 500 JSON `{error:"Failed to fetch supply details",details:error.message}` with actual current detail behavior |
| `/api/health` | Existing healthy/service/timestamp JSON, 200 with no explicit cache header; current method handling unchanged |
| `/` | Existing JSON root keys/links/endpoint entries and 3600-second cache; additive discovery only, current method handling unchanged |
| Other paths | Existing 404 text `Not found`, current CORS and no explicit cache header |

Supply GET/OPTIONS only; HEAD and other methods remain 405. Plain routes' OPTIONS are 200/empty and 405 text `Method not allowed`; detailed supply OPTIONS is 200 with JSON `null`, 405 JSON `{error:"Method not allowed"}`. Preserve their differing headers: text has UTF-8 text content type, wildcard origin and `GET, OPTIONS`; detail has UTF-8 JSON, wildcard origin, allowed methods and `Content-Type` allowed header. Do not add pricing headers/cache policy to these routes. Error/method/preflight responses retain their current absence of cache headers. HTTP transports suppress HEAD bodies; tests of the existing Worker Response must preserve its current constructed body rather than normalize it during this work.

Detailed success fields/types remain: `total_supply`, `circulating_supply`, `total_excluded` strings; five `excluded_wallets` in current order, each `name`, `address`, `purpose`, `balance`, `balance_with_decimals` strings; original UTC `timestamp`; numeric `decimals: 18`; unchanged token object. Keep all five addresses/purposes and the contract constant byte-identical. Subtract the sum of raw 18-decimal balances from raw total **before** integer division; do not sum rounded wallet displays or convert through Number. Preserve the current 18-place balance string formatting.

Preserve separate 60,000 ms warm caches (strict `<` boundary), provider list/order/preferred-provider state, sequential five-wallet requests, 8,000 ms per-attempt timeout, malformed-reply/error fallback and current rounding. Preserve last-good memory then Cache API behavior, the internal cache keys and seven-day Cache API TTL. Memory has no explicit age limit; stale success remains 200/`X-Stale: true` and detailed fallback retains its original timestamp. This policy is **not** reused for pricing. CoinGecko/CoinMarketCap are supply consumers, not supply-provider or pricing-query dependencies of this Worker.

No changes to legacy `api/*.js`, wallets, RPCs, `vercel.json`, hosting/domain/rollback settings or package semantics. Add the actual approved namespace binding only after setup; no guessed namespace id. Current `workers.dev` and production are the same Worker, not isolated staging. Do not use deploying to that host as a pre-deployment test.

## 5. Root JSON and thin llms.txt

Keep root JSON authoritative and additive: existing `service`, `description`, `source`, `endpoints` and `_links` remain, including current entries. Add `overview` (ordinary prose), `interfaces` (bounded list below), `documentation` (labelled links), and pricing/llms entries and links. Use **one hand-maintained description/link object in the existing Worker module** to render these additions and `/llms.txt`; no general documentation framework, duplicated prose file, HTML route or OpenAPI layer.

**Owner naming correction (2026-09-10):** the public directory is broader than token supply. Its shared `service` name and llms heading are **Autonomi API**, not the inherited ANT Supply API. The shared short description is **Token supply, storage-cost estimates, and information about the APIs and tools for accessing Autonomi.** This intentionally supersedes only the root directory's old name/description values; keys, URLs, methods, supply payloads and health payload remain unchanged. Matching root-name assertions may be updated, not other supply/health expectations. Remaining long-form discovery prose is still draft for Jim's copy review.

**Owner description correction (2026-09-10):** use **upload-cost estimates** in the overview, not “dated upload-cost references”. Override only these two endpoint descriptions:

| Endpoint | Exact directory description |
| --- | --- |
| `/api/health` | Checks whether this API service is responding. It does not check the Autonomi network or the freshness of supply or pricing data. |
| `/api/pricing` | Upload-cost estimates for adding data to Autonomi, including storage fees and network transaction costs. These are not live quotes or guaranteed prices. For a file-specific estimate, use the Autonomi CLI or another supported client tool. |

The actual health handler/payload (including its legacy service name) and all three supply descriptions/responses remain unchanged. The public pricing introduction does not name the private producer or carry HTTP/status/header instructions. Those technical details, the current-USD prohibition and original-date limits remain in sections 1–3 and the README; this copy correction changes no validation, provenance, expiry or response contract.

Each interface entry has `id`, `name`, `description`, `access` (`local-daemon`, `daemon-client`, or `direct-network`), and `documentation: [{label,url}]`. Hosted entries stay in `endpoints` with the existing `{path,method,content_type,description}` shape. Add `/api/pricing` with method `GET`/content type `application/json` and `/llms.txt` with `GET`/`text/plain`; `_links` gains keys `pricing` and `llms` and remains request-origin-derived for local exercises, with canonical production URLs in published guidance. Root/llms handlers do not read KV or fetch providers; pricing unavailability must not erase the directory. An entry describes an implemented route, not a claim of a successful daily refresh.

The JSON directory advertises `/llms.txt`, but the llms rendering omits that endpoint from its own hosted-information list. This avoids the self-referential entry Jim identified while keeping discovery available from the root. Use a simple rendering filter over the shared descriptions, not a separately maintained endpoint list; all other descriptions/links remain shared.

Draft overview for Jim's final copy pass:

> This API publishes information about Autonomi: token supply and upload-cost estimates. It is not a hosted gateway for uploading or retrieving network data. For network access, run a supported client locally: antd exposes local REST and gRPC interfaces, daemon-backed SDKs and MCP tools call antd, while the ant CLI and Rust ant-core client can access the network directly. Choose an interface below and follow its setup guide; installing a daemon does not start its service.

Required interface distinctions and destinations:

| id / access | Description content and labelled documentation |
| --- | --- |
| `antd` / `local-daemon` | Local running daemon handles network operations; [start/setup](https://docs.autonomi.com/developers/sdk/install/start-the-local-daemon.md), [REST reference](https://docs.autonomi.com/developers/sdk/install/reference/rest-api.md), [gRPC reference](https://docs.autonomi.com/developers/sdk/install/reference/grpc-services.md) |
| `daemon-sdks` / `daemon-client` | These language clients call antd, not a hosted endpoint here; [SDK setup](https://docs.autonomi.com/developers/sdk/install.md), [language binding model](https://docs.autonomi.com/developers/sdk/install/reference/language-bindings/overview.md). Do not generalize this to every SDK/FFI package. |
| `antd-mcp` / `daemon-client` | Local MCP server uses antd; no hosted MCP service implied; [setup/source](https://github.com/WithAutonomi/ant-sdk/tree/main/antd-mcp), [MCP guide](https://docs.autonomi.com/developers/mcp/use-mcp-with-ai-tools.md) |
| `ant` / `direct-network` | ant CLI data commands access the network directly; its node-management daemon is not antd; [CLI guide](https://docs.autonomi.com/developers/cli/use-the-cli.md), [command reference](https://docs.autonomi.com/developers/cli/command-reference), [source](https://github.com/WithAutonomi/ant-client) |
| `ant-core` / `direct-network` | Direct native Rust client, not a daemon/CLI wrapper; [Rust guide](https://docs.autonomi.com/developers/developing-in-rust/build-directly-in-rust.md), [library reference](https://docs.autonomi.com/developers/developing-in-rust/library-reference.md) |

Top-level documentation includes [developer overview](https://docs.autonomi.com/developers), [documentation llms.txt](https://docs.autonomi.com/llms.txt) and this API's [source/README](https://github.com/WithAutonomi/api). These actual destinations/descriptions were checked in the 2026-09-09 [launch preflight's “Verified interface documentation links”](https://github.com/WithAutonomi/developers/blob/feat/pricing-widget-v1/planning/research/pricing-launch-preflight-2026-09-09.md). That evidence establishes documentation navigation, **not successful installation/network operation**. Recheck links/content before final publication; don't copy a known-broken installer line, assert all SDKs require a daemon, or advertise prices/tool/version counts here. Final public prose is subject to Jim's review.

Append [CLI file-specific cost estimates](https://docs.autonomi.com/developers/cli/command-reference) and [Local REST API cost estimates](https://docs.autonomi.com/developers/sdk/install/reference/rest-api.md) to that existing shared `documentation` list, in that order. These reuse the existing command-reference and local REST destinations; no new path, endpoint field or renderer is required. On 2026-09-10 the coordinator read the published command-reference Markdown and REST reference (both HTTP200): they document `ant file cost <PATH>`, `POST /v1/data/cost` and `POST /v1/files/cost` as cost-estimation operations. This verifies documentation content, not successful installation, a live estimate or upload.

`GET /llms.txt`: 200 `text/plain; charset=utf-8`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, OPTIONS`, `Allow: GET, OPTIONS`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=3600`; UTF-8/LF text at most **16,384 bytes**. Render heading, shared overview, hosted endpoint descriptions/absolute links, interface descriptions/labelled links and documentation links, in source order, with final LF. No live prices/supply values or second documentation body. OPTIONS 204/empty/no-store; other methods 405 text `Method not allowed`/no-store (HEAD no body), same non-cache headers. These new method rules do not alter root's existing handling. Root JSON including additions is also bounded to **16,384 bytes**.

## 6. Acceptance

- Run supply preservation tests against the unchanged baseline before the implementation delta; retain literal expected values/types, methods/preflight/errors, rounding, warm-cache boundary, provider preference/fallback, malformed replies, and both last-good paths. Pricing failure must neither invoke nor affect supply.
- Test missing/throwing/stalled KV, oversize streams/metadata, invalid UTF-8/JSON, hash/revision mismatch, complete structure, unknown schema/model/provenance, chronology and both exact expiry boundaries. Test 200/native-valid/reference-expired with identical body bytes and capped cache/header state.
- Assert zero external fetches on pricing/root/llms, exactly one KV read on valid pricing GET and none on pricing OPTIONS/405 or other routes; preserve root keys/links/method behavior. Assert shared-description/link parity and bounded discovery output.
- Local checks are not authoritative CI. Unit 1 adds the separate Node22 test/CI mechanism; use its committed commands and ADR validation when available. No new dependency or changes to gates/build/runtime setup belong to this contract-only task. Live pricing release probes occur only after separate approved setup/deployment/publication.
