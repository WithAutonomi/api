// ANT Token Supply API — Cloudflare Worker
// Port of the Vercel functions in /api. Same endpoints, same response
// formats: total-supply and circulating-supply are plain-text numbers
// (what CoinMarketCap/CoinGecko poll), health and supply are JSON.

import { handlePricing } from "./pricing.mjs";

// Public Arbitrum One RPC endpoints, tried in order. Public RPCs rate-limit
// by source IP, and a Worker shares Cloudflare's egress IPs with many other
// tenants, so any single endpoint can answer "Too Many Requests" at any
// moment (seen at cutover, 9 Sep 2026). The endpoint that last worked is
// tried first on the next call.
const ARBITRUM_RPCS = [
  "https://arb1.arbitrum.io/rpc",
  "https://arbitrum-one-rpc.publicnode.com",
  "https://arbitrum.drpc.org",
  "https://arbitrum-one.public.blastapi.io",
  "https://1rpc.io/arb",
];
const RPC_TIMEOUT_MS = 8000;
let preferredRpc = 0;

const ANT_CONTRACT = "0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684";
const TOTAL_SUPPLY = BigInt("1200000000000000000000000000"); // 1.2B with 18 decimals
const DECIMALS = 18;

// Wallets excluded from circulating supply
const EXCLUDED_WALLETS = [
  {
    name: "Network Emissions",
    address: "0xdA4f3aF146f86850DE8e0D6FaE6EEe051Ad0AA44",
    purpose: "Network rewards and emissions for node operators",
  },
  {
    name: "MAID Airdrop Wallet",
    address: "0x675D39cdCEA31ba8313565b03D684A3bbe183a1a",
    purpose: "Tokens for MAID token holders airdrop",
  },
  {
    name: "Foundation Cold Wallet",
    address: "0x4f7B7fd0533d06D2ABFad07eAe57C9CE8E92B670",
    purpose: "Foundation treasury and long-term reserves",
  },
  {
    name: "Foundation Hot Wallet",
    address: "0xd10A556E6A5111b5D4Dd5Ae06761d41F6CE1D499",
    purpose: "Foundation operational wallet",
  },
  {
    name: "Shareholder NFT Contract",
    address: "0x1617C551E1d63e693b0F6B42FE5352a79f2F9961",
    purpose: "Tokens locked in Shareholder NFT smart contract",
  },
];

// In-memory caches persist per Worker isolate, mirroring the warm-lambda
// caches in the Vercel version
const CACHE_DURATION = 60 * 1000; // 1 minute
let circulatingCache = { data: null, timestamp: 0 };
let detailedCache = { data: null, timestamp: 0 };

// Stale fallback: if the Arbitrum RPC fails, serve the last good figure
// rather than a 500 — CMC/CoinGecko prefer slightly stale over error.
// Two layers: module memory (lost on isolate restart) and the Cache API
// (survives restarts; a no-op on workers.dev, effective on the custom
// domain). Stale responses carry an X-Stale: true header.
let lastGoodCirculating = null;
let lastGoodDetailed = null;
const STALE_CACHE_BASE = "https://stale-supply.internal/";
const STALE_TTL_SECONDS = 7 * 24 * 3600;

async function putStale(key, body) {
  try {
    await caches.default.put(
      new Request(STALE_CACHE_BASE + key),
      new Response(body, {
        headers: { "Cache-Control": `max-age=${STALE_TTL_SECONDS}` },
      })
    );
  } catch (e) {
    // Cache API unavailable (e.g. workers.dev) — memory layer still applies
  }
}

async function getStale(key) {
  try {
    const hit = await caches.default.match(new Request(STALE_CACHE_BASE + key));
    return hit ? await hit.text() : null;
  } catch (e) {
    return null;
  }
}

// JSON-RPC call with endpoint fallback. Any HTTP error, JSON-RPC error,
// malformed reply, network failure or timeout moves on to the next endpoint;
// only when every endpoint has failed does this throw.
async function rpcCall(method, params, endpoints = ARBITRUM_RPCS) {
  const errors = [];
  for (let i = 0; i < endpoints.length; i++) {
    const idx = (preferredRpc + i) % endpoints.length;
    const url = endpoints[idx];
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error.message);
      if (typeof result.result !== "string") throw new Error("malformed result");
      preferredRpc = idx;
      return result.result;
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(`RPC error: all endpoints failed (${errors.join("; ")})`);
}

// Query wallet balance using eth_call
async function getBalance(walletAddress) {
  // ERC20 balanceOf(address) function signature
  const data = "0x70a08231000000000000000000000000" + walletAddress.slice(2).toLowerCase();
  const hex = await rpcCall("eth_call", [{ to: ANT_CONTRACT, data }, "latest"]);
  return BigInt(hex);
}

// Format BigInt to human-readable number (without decimals)
function formatSupply(value) {
  return (value / BigInt(10 ** DECIMALS)).toString();
}

// Format BigInt to full decimal representation
function formatWithDecimals(value) {
  const str = value.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, -DECIMALS) || "0";
  const decPart = str.slice(-DECIMALS);
  return `${intPart}.${decPart}`;
}

// Returns { value, stale }; throws only if there is no fallback anywhere
async function calculateCirculatingSupply() {
  const now = Date.now();
  if (circulatingCache.data && now - circulatingCache.timestamp < CACHE_DURATION) {
    return { value: circulatingCache.data, stale: false };
  }

  try {
    let totalExcluded = BigInt(0);
    for (const wallet of EXCLUDED_WALLETS) {
      const balance = await getBalance(wallet.address);
      totalExcluded += balance;
    }

    const formattedSupply = formatSupply(TOTAL_SUPPLY - totalExcluded);
    circulatingCache = { data: formattedSupply, timestamp: now };
    lastGoodCirculating = formattedSupply;
    await putStale("circulating", formattedSupply);
    return { value: formattedSupply, stale: false };
  } catch (error) {
    const fallback = lastGoodCirculating ?? (await getStale("circulating"));
    if (fallback !== null) {
      console.error("RPC failed, serving stale circulating supply:", error);
      return { value: fallback, stale: true };
    }
    throw error;
  }
}

// Returns { value, stale }; throws only if there is no fallback anywhere.
// A stale value keeps its original timestamp, honestly showing data age.
async function getDetailedSupply() {
  const now = Date.now();
  if (detailedCache.data && now - detailedCache.timestamp < CACHE_DURATION) {
    return { value: detailedCache.data, stale: false };
  }

  try {
    let totalExcluded = BigInt(0);
    const walletDetails = [];

    for (const wallet of EXCLUDED_WALLETS) {
      const balance = await getBalance(wallet.address);
      totalExcluded += balance;

      walletDetails.push({
        name: wallet.name,
        address: wallet.address,
        purpose: wallet.purpose,
        balance: formatSupply(balance),
        balance_with_decimals: formatWithDecimals(balance),
      });
    }

    const circulatingSupply = TOTAL_SUPPLY - totalExcluded;

    const data = {
      total_supply: formatSupply(TOTAL_SUPPLY),
      circulating_supply: formatSupply(circulatingSupply),
      total_excluded: formatSupply(totalExcluded),
      excluded_wallets: walletDetails,
      timestamp: new Date().toISOString(),
      decimals: DECIMALS,
      token: {
        name: "Autonomi Network Token",
        symbol: "ANT",
        contract: ANT_CONTRACT,
        blockchain: "Arbitrum One",
      },
    };

    detailedCache = { data: data, timestamp: now };
    lastGoodDetailed = data;
    await putStale("supply", JSON.stringify(data));
    return { value: data, stale: false };
  } catch (error) {
    let fallback = lastGoodDetailed;
    if (fallback === null) {
      const cached = await getStale("supply");
      if (cached !== null) fallback = JSON.parse(cached);
    }
    if (fallback !== null) {
      console.error("RPC failed, serving stale supply breakdown:", error);
      return { value: fallback, stale: true };
    }
    throw error;
  }
}

const TEXT_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "text/plain; charset=utf-8",
};

function textResponse(body, status, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...TEXT_CORS_HEADERS, ...extraHeaders },
  });
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

// One description/link source for root JSON and the thin prose directory.
// Carried forward from the prior pricing draft; not a new live availability check.
const DISCOVERY = {
  service: "Autonomi API",
  description: "Storage cost estimates for uploading data to Autonomi, ANT token supply information, and guidance for connecting applications and agents to the network.",
  source: "https://github.com/WithAutonomi/api",
  overview: "This is an information service, not a gateway to the Autonomi network: use it for planning and reference, not to upload or retrieve network data. For network operations over HTTP, install and start antd locally, then use its REST API. Daemon-backed SDKs and MCP tools connect to your running antd; the ant CLI and ant-core Rust client can connect directly. Follow each tool's source and README for setup and reference links; use the documentation index to discover current documentation pages.",
  endpoints: [
    {
      path: "/api/health",
      method: "GET",
      content_type: "application/json",
      description: "Checks whether this API service is responding. It does not check the Autonomi network or the freshness of supply or pricing data.",
    },
    {
      path: "/api/total-supply",
      method: "GET",
      content_type: "text/plain",
      description:
        "Total ANT supply as a bare integer string (CoinMarketCap/CoinGecko format)",
    },
    {
      path: "/api/circulating-supply",
      method: "GET",
      content_type: "text/plain",
      description:
        "Circulating ANT supply as a bare integer string: total supply minus excluded-wallet balances, read live from Arbitrum (CoinMarketCap/CoinGecko format)",
    },
    {
      path: "/api/supply",
      method: "GET",
      content_type: "application/json",
      description:
        "Detailed supply breakdown including each excluded wallet's live balance",
    },
    {
      path: "/api/pricing",
      method: "GET",
      content_type: "application/json",
      description: "Rates and worked examples for estimating the cost of storing data on Autonomi. Storage rates are weighted averages of observed ant.report payments; transaction fees are averaged separately, and USD rates use historical CoinGecko medians. The record includes averaging windows, observation dates, calculation parameters, assumptions and exclusions. These are not live quotes or guaranteed prices. Collection or validation failure preserves the saved record and its original dates; inspect the returned observation dates.",
    },
    {
      path: "/llms.txt",
      method: "GET",
      content_type: "text/plain",
      description: "A plain-text directory of these endpoints, client repositories and documentation entry points.",
    },
  ],
  interfaces: [
    {
      id: "antd",
      name: "antd local daemon",
      description: "Run antd on your own machine to store and retrieve Autonomi data through REST or gRPC. Its default REST address is http://127.0.0.1:8082, not api.autonomi.com. Keep it local: the daemon has no built-in authentication. Its external-signer flow lets applications prepare an upload, inspect payment details, pay externally and finalize; it is not a guaranteed all-in quote including transaction fees.",
      access: "local-daemon",
      documentation: [
        { label: "Source and README", url: "https://github.com/WithAutonomi/ant-sdk/tree/main/antd" },
      ],
    },
    {
      id: "daemon-sdks",
      name: "Daemon-backed language SDKs",
      description: "These language clients call your running antd, not a hosted endpoint on this API. This connection model does not apply to every Autonomi SDK or FFI package.",
      access: "daemon-client",
      documentation: [
        { label: "Source and README", url: "https://github.com/WithAutonomi/ant-sdk" },
      ],
    },
    {
      id: "antd-mcp",
      name: "antd MCP tools",
      description: "The local MCP server connects AI tools to your running antd. This API does not host an MCP service.",
      access: "daemon-client",
      documentation: [
        { label: "Source and README", url: "https://github.com/WithAutonomi/ant-sdk/tree/main/antd-mcp" },
      ],
    },
    {
      id: "ant",
      name: "ant command-line client",
      description: "Use ant to access the network directly. Run ant file cost <PATH> for a file-specific estimate based on sampled network quotes, or ant --json file cost <PATH> for structured output. This does not upload, pay, reserve a price or cap later spending. The CLI obtains quotes and pays during upload; it currently has no separate quote-review-and-approve command. Its node-management daemon is separate from antd.",
      access: "direct-network",
      documentation: [
        { label: "Source and README", url: "https://github.com/WithAutonomi/ant-client" },
      ],
    },
    {
      id: "ant-core",
      name: "ant-core Rust client",
      description: "Build directly on the network with the native Rust client. ant-core is not a wrapper around a daemon or command-line tool.",
      access: "direct-network",
      documentation: [
        { label: "Source", url: "https://github.com/WithAutonomi/ant-client/tree/main/ant-core" },
      ],
    },
  ],
  documentation: [
    { label: "Autonomi documentation", url: "https://docs.autonomi.com" },
    { label: "Documentation llms.txt", url: "https://docs.autonomi.com/llms.txt" },
    { label: "API source and README", url: "https://github.com/WithAutonomi/api" },
  ],
};

// Machine-readable index remains additive, with local-origin navigation links.
async function handleIndex(request) {
  const origin = new URL(request.url).origin;
  return jsonResponse(
    {
      ...DISCOVERY,
      _links: Object.fromEntries(DISCOVERY.endpoints.map(endpoint => [
        endpoint.path === "/llms.txt" ? "llms" : endpoint.path.slice("/api/".length),
        `${origin}${endpoint.path}`,
      ])),
    },
    200,
    { "Cache-Control": "public, max-age=3600" }
  );
}

async function handleLlms(request) {
  const headers = {
    "Allow": "GET, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (request.method === "OPTIONS") return textResponse(null, 204, headers);
  if (request.method !== "GET") {
    return textResponse(request.method === "HEAD" ? null : "Method not allowed", 405, headers);
  }
  const link = ({ label, url }) => `- [${label}](${url})`;
  const lines = [
    `# ${DISCOVERY.service}`, "", DISCOVERY.description, "", DISCOVERY.overview, "",
    "## Hosted information", "",
    ...DISCOVERY.endpoints.filter(endpoint => endpoint.path !== "/llms.txt").map(endpoint =>
      `- [${endpoint.method} ${endpoint.path}](https://api.autonomi.com${endpoint.path}): ${endpoint.description}`),
    "", "## Network access from your client", "",
    ...DISCOVERY.interfaces.flatMap(entry => [
      `### ${entry.name}`, "", entry.description, "", ...entry.documentation.map(link), "",
    ]),
    "## Documentation", "", ...DISCOVERY.documentation.map(link), "",
  ];
  return textResponse(lines.join("\n"), 200, { ...headers, "Cache-Control": "public, max-age=3600" });
}

async function handleHealth() {
  return jsonResponse(
    {
      status: "healthy",
      service: "ANT Supply API",
      timestamp: new Date().toISOString(),
    },
    200
  );
}

async function handleTotalSupply(request) {
  if (request.method === "OPTIONS") {
    return textResponse(null, 200);
  }
  if (request.method !== "GET") {
    return textResponse("Method not allowed", 405);
  }
  return textResponse("1200000000", 200, { "Cache-Control": "public, max-age=3600" });
}

async function handleCirculatingSupply(request) {
  if (request.method === "OPTIONS") {
    return textResponse(null, 200);
  }
  if (request.method !== "GET") {
    return textResponse("Method not allowed", 405);
  }

  try {
    const { value, stale } = await calculateCirculatingSupply();
    return textResponse(value, 200, {
      "Cache-Control": "public, max-age=60",
      ...(stale ? { "X-Stale": "true" } : {}),
    });
  } catch (error) {
    console.error("Error calculating circulating supply:", error);
    return textResponse("Error calculating circulating supply", 500);
  }
}

async function handleSupply(request) {
  const corsHeaders = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return jsonResponse(null, 200, corsHeaders);
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const { value, stale } = await getDetailedSupply();
    return jsonResponse(value, 200, {
      ...corsHeaders,
      "Cache-Control": "public, max-age=60",
      ...(stale ? { "X-Stale": "true" } : {}),
    });
  } catch (error) {
    console.error("Error fetching supply details:", error);
    return jsonResponse(
      { error: "Failed to fetch supply details", details: error.message },
      500,
      corsHeaders
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    switch (path) {
      case "/": // service index (the Vercel version routed / to health)
        return handleIndex(request);
      case "/llms.txt":
        return handleLlms(request);
      case "/api/pricing":
        return handlePricing(request, env);
      case "/api/health":
        return handleHealth();
      case "/api/total-supply":
        return handleTotalSupply(request);
      case "/api/circulating-supply":
        return handleCirculatingSupply(request);
      case "/api/supply":
        return handleSupply(request);
      default:
        return textResponse("Not found", 404);
    }
  },
};
