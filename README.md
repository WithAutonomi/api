# Autonomi API

Storage cost estimates for uploading data to Autonomi, ANT token supply
information, and guidance for connecting applications and agents to the network.

**Base URL:** https://api.autonomi.com

**This is an information service, not a gateway to the Autonomi network.**
You cannot upload, download or otherwise interact with network data through
this host. To use the network, start at [Autonomi Developers](https://developers.autonomi.com).
Agents should use the [developer `llms.txt`](https://developers.autonomi.com/llms.txt).

## Which interface do I need?

| What you want to do | Where to go |
| --- | --- |
| Estimate storage costs when planning an application or upload | This service: [`GET /api/pricing`](https://api.autonomi.com/api/pricing) |
| Get a file-specific estimate or make an upload payment | Current client guidance at [Autonomi Developers](https://developers.autonomi.com) |
| Store or retrieve data through REST or gRPC | Run the local `antd` daemon; see [Autonomi Developers](https://developers.autonomi.com) |
| Use Autonomi from an AI tool | Use daemon-backed MCP tools; see the [developer `llms.txt`](https://developers.autonomi.com/llms.txt) |
| Build with a language SDK | Choose a current daemon-backed or direct client at [Autonomi Developers](https://developers.autonomi.com) |
| Use the network from a terminal | Use the direct `ant` command-line client; see [Autonomi Developers](https://developers.autonomi.com) |
| Build directly against the network in Rust | Use the native `ant-core` client; see [Autonomi Developers](https://developers.autonomi.com) |
| Read ANT token supply figures | [`GET /api/supply`](https://api.autonomi.com/api/supply), with plain-number endpoints listed below |

## Hosted endpoints

These public, read-only endpoints require no API key.

| Endpoint | Format | Purpose |
| --- | --- | --- |
| `GET /` | JSON | Service directory, endpoint descriptions and network-access signposts |
| `GET /llms.txt` | Text | The same signposts in a readable directory for agents |
| `GET /api/pricing` | JSON | Rates, examples and assumptions for Autonomi storage-cost estimates |
| `GET /api/total-supply` | Plain number | Total ANT token supply |
| `GET /api/circulating-supply` | Plain number | Circulating ANT token supply |
| `GET /api/supply` | JSON | Supply breakdown, including excluded wallet balances |
| `GET /api/health` | JSON | Whether this information service is responding, not network health or data freshness |

All endpoints allow cross-origin reads. The two plain-number supply responses
are also used by CoinMarketCap and CoinGecko.

## Storage-cost estimates

Use `/api/pricing` to estimate the cost of storing data. Estimates include storage
fees and blockchain transaction fees, based on observed payments. They are
intended for planning and budgeting, not as live quotes or guaranteed upload prices.

```bash
curl https://api.autonomi.com/api/pricing
```

The response separates:

- **Storage fees**, paid in ANT.
- **Blockchain transaction fees**, paid in ETH.
- **USD conversions**, using separately dated ANT and ETH exchange rates.

It includes examples for 1 MB, 1 GB and 1 TB, the calculation model, source
links, observation dates, averaging windows, assumptions and exclusions.
The endpoint returns a saved reference dataset; it does not accept a file or
an amount to quote.

### How the estimates are calculated

Reference data is scheduled to refresh daily. The current calculation uses:

| Component | Method |
| --- | --- |
| Storage | Seven-day weighted averages of payments reported by [ant.report](https://www.ant.report), calculated separately for ordinary and batch payments |
| Transaction fees | Observed ETH fees per billed unit over the recent 24 hours, calculated separately for each payment method |
| Transaction-fee fallback | A separate seven-day window, used only when the recent window contains no returned billed units for that method |
| USD conversion | The median ANT/USD and ETH/USD observations from [CoinGecko](https://www.coingecko.com) over the preceding 24 hours |

A weighted storage average divides the total observed ANT paid by the total
billed units. It does not give a small upload the same weight as a large one.

The calculation converts a data size into billable chunks or batch units,
including the model's minimum chunk count and batch padding. Transaction-fee
rates are **per billed unit, not per blockchain transaction**. Examples use
decimal data units: 1 MB is 1,000,000 bytes.

The response's `settings`, `windows`, `gas_basis` and `calculation` fields
describe the actual method used for that record. Read them rather than assuming
these durations or model parameters will never change.

### What the estimate does not promise

These are historical estimates, not live quotes, spending limits or guaranteed
upload prices. The observations returned by the source are not a guarantee of
complete coverage of every network payment.

The model assumes one logical upload with all source chunks payable. It excludes
DataMap overhead, which is the retrieval information needed to reconstruct a
file; savings from chunks already stored; changes of payment method during an
upload; and separate token-spending approval fees. Reported transaction fees may
also omit some costs involving intermediary contracts.

File contents, payment method, responding nodes, current prices and wallet state
can all affect what an actual upload costs.

### Dates and unavailable updates

Network observations, currency observations, generation and publication have
different dates. A successful HTTP request does not make the underlying prices
new.

If the publisher cannot collect or validate a replacement before publication,
it leaves the previous saved record and its original dates in place. A seven-day
averaging window is **not** a seven-day expiry time. Consumers should display the
observation dates and decide whether the record is suitable for their purpose.

### Reading the response

The top-level response contains `record` and publication metadata.

| Field | Meaning |
| --- | --- |
| `record.rates` | ANT storage and ETH transaction-fee rates for each payment method |
| `record.exchange_reference` | Saved USD conversion rates, their source and observation window |
| `record.examples` | Worked estimates with storage, transaction fees and totals |
| `record.calculation` | Calculation version and billing-model parameters |
| `record.settings`, `record.windows`, `record.gas_basis` | Averaging methods, observation windows and selected transaction-fee window |
| `record.source.data_as_of` | Network observations are current as of this date |
| `record.assumptions`, `record.exclusions`, `record.guidance` | Interpretation limits and routes to file-specific estimates |
| `data_revision`, `payload_sha256`, `published_at` | Publication diagnostics, not evidence of fresh network observations |

Monetary values are decimal strings. Preserve their precision when calculating;
round only for display. Hosted pricing uses whole ANT and ETH units, which
differ from the smallest-unit amounts returned by some local client APIs.

The pricing endpoint accepts `GET` and `OPTIONS`. It returns
`503 {"error":"pricing_unavailable"}` if the saved record is missing, unreadable
or invalid. Pricing responses use `Cache-Control: no-store`.

## File-specific estimates and upload payments

This service provides historical reference estimates; it does not inspect a
file, request network quotes, reserve a price or take payment. Current Autonomi
client tools can process a particular file and network conditions for a more
specific estimate. Applications can also use local client workflows to inspect
and authorize upload payments without sending those operations through this API.

For current commands, payment workflows and their limitations, start at
[Autonomi Developers](https://developers.autonomi.com). Agents should discover
the applicable guide through the [developer `llms.txt`](https://developers.autonomi.com/llms.txt).
An estimate from any client is not a reserved price or spending cap.

## Accessing the Autonomi network

Network operations happen through software running for the client, **not through
`api.autonomi.com`**. The available routes serve different kinds of application:

### Local APIs

- Run the `antd` daemon when an application needs local REST or gRPC interfaces
  for storing, retrieving, estimating costs or handling payments.
- Use daemon-backed language SDKs when application code should call that local
  service instead of handling network access directly.
- Use daemon-backed MCP tools when an AI application or agent needs network tools.

Treat the daemon as a local service and follow the current setup and security
guidance at [Autonomi Developers](https://developers.autonomi.com).

### Direct clients

- Use the `ant` command-line client for terminal-based estimates, uploads,
  downloads and other network operations.
- Use the native `ant-core` client when a Rust application should connect
  directly rather than through a local daemon.

For people, [Autonomi Developers](https://developers.autonomi.com) owns the
current routes into these tools. For agents, the
[developer `llms.txt`](https://developers.autonomi.com/llms.txt) points to the
current guides and source locations. For broader context, see the
[network overview `llms.txt`](https://autonomi.com/llms.txt).

## ANT token supply

Total supply is 1,200,000,000 ANT. Circulating supply subtracts the balances of
the excluded wallets below from that total, using the ANT contract on Arbitrum
One: `0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684`.

| Excluded wallet | Address |
| --- | --- |
| Network Emissions | `0xdA4f3aF146f86850DE8e0D6FaE6EEe051Ad0AA44` |
| MAID Airdrop Wallet | `0x675D39cdCEA31ba8313565b03D684A3bbe183a1a` |
| Foundation Cold Wallet | `0x4f7B7fd0533d06D2ABFad07eAe57C9CE8E92B670` |
| Foundation Hot Wallet | `0xd10A556E6A5111b5D4Dd5Ae06761d41F6CE1D499` |
| Shareholder NFT Contract | `0x1617C551E1d63e693b0F6B42FE5352a79f2F9961` |

`/api/supply` includes the total, circulating and excluded amounts, each excluded
wallet's balance, token details and a timestamp.

| Response field | Type and meaning |
| --- | --- |
| `total_supply`, `circulating_supply`, `total_excluded` | Strings containing whole ANT amounts |
| `excluded_wallets` | Array of wallet objects: `name`, `address`, `purpose`, `balance` and `balance_with_decimals` are strings; `balance` is whole ANT and `balance_with_decimals` retains fractional ANT |
| `timestamp` | ISO timestamp string for the calculated breakdown, retained when a saved result is served |
| `decimals` | Number `18`, the token's decimal precision |
| `token` | Object with string fields `name`, `symbol`, `contract` and `blockchain` |

The plain-number endpoints return unwrapped integers for existing consumers.
Circulating supply and the detailed breakdown use public blockchain RPC providers
and a 60-second cache. Total supply is fixed and has a one-hour cache header.
If providers fail, the service serves its last available good result with
`X-Stale: true`; it returns an error if no fallback is available.
Supply endpoints accept `GET` and `OPTIONS`.

## Maintain and Contribute

To maintain and contribute to this service, see [the contributor guide](CONTRIBUTING.md)
for local development, testing, deployment and maintenance instructions.
