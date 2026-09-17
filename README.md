# Autonomi API

Storage cost estimates for uploading data to Autonomi, ANT token supply
information, and guidance for connecting applications and agents to the network.

**Base URL:** https://api.autonomi.com

**This is an information service, not a gateway to the Autonomi network.**
You cannot upload or retrieve network data through this host. For network
operations over HTTP, run the [`antd` daemon](https://github.com/WithAutonomi/ant-sdk/tree/main/antd)
locally and use its REST API. The [`ant` command-line client](https://github.com/WithAutonomi/ant-client)
and native Rust client, [`ant-core`](https://github.com/WithAutonomi/ant-client/tree/main/ant-core),
can also connect directly.

## Which interface do I need?

| What you want to do | Where to go |
| --- | --- |
| Estimate storage costs when planning an application or upload | This service: [`GET /api/pricing`](https://api.autonomi.com/api/pricing) |
| Estimate the cost of a particular file | [`ant` CLI](https://github.com/WithAutonomi/ant-client): `ant file cost <PATH>` |
| Store or retrieve data through a REST API | [`antd` local daemon](https://github.com/WithAutonomi/ant-sdk/tree/main/antd) |
| Inspect upload-specific payment details before an application pays | [`antd`](https://github.com/WithAutonomi/ant-sdk/tree/main/antd): prepare, external payment and finalize |
| Use Autonomi from an AI tool | [`antd-mcp`](https://github.com/WithAutonomi/ant-sdk/tree/main/antd-mcp), connected to your running daemon |
| Use the network from a terminal | [`ant` CLI](https://github.com/WithAutonomi/ant-client) |
| Build directly against the network in Rust | [`ant-core`](https://github.com/WithAutonomi/ant-client/tree/main/ant-core) |
| Read ANT token supply figures | [`GET /api/supply`](https://api.autonomi.com/api/supply), with plain-number endpoints listed below |

## Hosted endpoints

These public, read-only endpoints require no API key.

| Endpoint | Format | Purpose |
| --- | --- | --- |
| `GET /` | JSON | Service directory, endpoint descriptions and links to network clients |
| `GET /llms.txt` | Text | The same guidance in a readable directory for agents |
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

If collection or validation fails, the service retains the last valid record and
its original dates. A seven-day averaging window is **not** a seven-day expiry time. Consumers
should display the observation dates and decide whether the record is suitable
for their purpose.

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

## File-specific estimates and actual quotes

After installing the [Autonomi CLI](https://github.com/WithAutonomi/ant-client),
request an estimate for a local file:

```bash
ant file cost <PATH>
```

For machine-readable output:

```bash
ant --json file cost <PATH>
```

The command processes the file locally and estimates its cost using sampled
network quotes. It does not upload or pay for the file. Its gas figure is an
estimate too: the result is not a reserved price or a cap on a subsequent upload,
and it is not guaranteed to be more accurate than a historical average.

The CLI obtains quotes and performs payment during upload. It currently has no
separate `ant file quote` command or quote-review-and-approve step.

Applications needing to inspect upload-specific payment details before paying
can use the [local daemon](https://github.com/WithAutonomi/ant-sdk/tree/main/antd)'s
prepare, external payment and finalize flow.
This returns the details needed to construct payment; it is not a guaranteed
all-in price including transaction fees.

## Accessing the Autonomi network

### Local REST API

`antd` is a service you run on your own machine. It connects to Autonomi and
exposes local REST and gRPC interfaces for applications.

Follow the [daemon's README](https://github.com/WithAutonomi/ant-sdk/tree/main/antd)
to install and start it. Its default REST address is `http://127.0.0.1:8082`.
After startup, check the local service with:

```bash
curl http://127.0.0.1:8082/health
```

The daemon's README provides setup instructions and an API-endpoint overview
for storing and retrieving data, estimating file costs, wallet operations and
externally signed payments. File-path arguments refer to files on the machine
running the daemon.

These requests go to your daemon, **not to `api.autonomi.com`**.
Keep the daemon bound to the local machine: it has no built-in authentication.

### Other client options

- [Daemon-backed language SDKs](https://github.com/WithAutonomi/ant-sdk)
  call your running `antd`.
- [MCP tools](https://github.com/WithAutonomi/ant-sdk/tree/main/antd-mcp)
  connect AI tools to that daemon. This hosted service does not provide an MCP endpoint.
- The [`ant` CLI](https://github.com/WithAutonomi/ant-client) connects
  directly to the network. Its node-management daemon is separate from `antd`.
- [`ant-core`](https://github.com/WithAutonomi/ant-client/tree/main/ant-core)
  provides direct network access for Rust applications. Not every Autonomi SDK
  or native binding requires a daemon.

For broader guidance, see the [Autonomi documentation](https://docs.autonomi.com)
and its [agent-readable index](https://docs.autonomi.com/llms.txt). Use that index
to discover current documentation pages; each tool's README owns its detailed
setup and reference links.

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
