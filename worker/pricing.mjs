// Inventory owns derivation. This reader checks the public shape, not evidence or maths.
const MODEL = {
  calculation_id: "inventory-pricing-prototype", calculation_version: "2",
  client_version: "0.3.6", client_revision: "dbc01ce8fdbdfe9ac4d064d35f36b4684bf6a616",
  source_chunk_bytes: "4190208", min_source_bytes: "3", min_chunks: "3",
  auto_batch_min_chunks: "64", single_wave_max_chunks: "64", batch_max_leaves: "256",
  max_source_bytes: "1000000000000000", max_amount_digits: "13",
};
const UNITS = { KB: "1000", MB: "1000000", GB: "1000000000", TB: "1000000000000" };
const RATE = /^(0|[1-9]\d{0,23})(\.\d{1,24})?$/;
const MONEY = /^(0|[1-9]\d*)(\.\d+)?$/;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Allow": "GET, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function requireValue(ok) {
  if (!ok) throw new Error("Invalid pricing record");
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string" && value.trim().length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const positive = (value, pattern = RATE) => typeof value === "string" &&
  value.length <= 128 && pattern.test(value) && /[1-9]/.test(value);

function date(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value));
  const time = Date.parse(value);
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  requireValue(Number.isFinite(time) && new Date(time).toISOString() === normalized);
  return time;
}

function url(value) {
  requireValue(text(value));
  const parsed = new URL(value);
  requireValue(parsed.protocol === "https:" && !parsed.username && !parsed.password);
}

function networkWindow(window, settings, asOf) {
  requireValue(object(window) && object(settings));
  requireValue(integer(settings.window_seconds) && settings.window_seconds > 0 &&
    integer(settings.bucket_seconds) && settings.bucket_seconds > 0);
  requireValue(window.bucket_seconds === settings.bucket_seconds && integer(window.cutoff_unix) &&
    integer(window.latest_returned_bucket_unix));
  requireValue(window.latest_returned_bucket_unix - window.cutoff_unix === settings.window_seconds &&
    window.latest_returned_bucket_unix <= asOf / 1000);
  const buckets = window.bucket_timestamps;
  requireValue(Array.isArray(buckets) && buckets.length > 0);
  let previous = -1;
  for (const bucket of buckets) {
    requireValue(integer(bucket) && bucket > previous && bucket % settings.bucket_seconds === 0 &&
      bucket >= window.cutoff_unix && bucket <= window.latest_returned_bucket_unix);
    previous = bucket;
  }
  requireValue(previous === window.latest_returned_bucket_unix);
}

function validate(envelope) {
  requireValue(object(envelope) && object(envelope.record));
  requireValue(typeof envelope.data_revision === "string" && /^[a-f0-9]{40}$/.test(envelope.data_revision));
  requireValue(typeof envelope.payload_sha256 === "string" && /^[a-f0-9]{64}$/.test(envelope.payload_sha256));
  const record = envelope.record;
  requireValue(record.schema_version === 1 && record.kind === "upload-pricing-reference");
  const generated = date(record.generated_at);
  const published = date(envelope.published_at);
  requireValue(generated <= published && published <= Date.now() + 60000);
  const source = record.source;
  requireValue(object(source) && source.name === "ant.report");
  const asOf = date(source.data_as_of);
  const provider = date(source.provider_generated_at);
  requireValue(asOf <= provider && provider <= generated && date(source.metadata_generated_at) <= generated &&
    date(source.captured_at) <= generated);
  url(source.payment_url);
  url(source.meta_url);
  requireValue(["mapped-observation", "scheduled-collector"].includes(source.provenance));
  if (source.provenance === "mapped-observation") url(source.record_url);
  else requireValue(source.record_url === null);

  requireValue(object(record.calculation) && object(record.calculation.amount_unit_bytes));
  for (const [key, value] of Object.entries(MODEL)) requireValue(record.calculation[key] === value);
  for (const [key, value] of Object.entries(UNITS)) requireValue(record.calculation.amount_unit_bytes[key] === value);
  requireValue(object(record.rates));
  for (const key of ["single_ant_per_chunk", "single_eth_per_chunk", "batch_ant_per_leaf", "batch_eth_per_leaf"]) {
    requireValue(positive(record.rates[key]));
  }
  const settings = record.settings;
  requireValue(object(settings) && object(settings.storage) && object(settings.gas) && object(settings.fx));
  requireValue(settings.storage.method === "weighted-mean" && settings.gas.method === "weighted-mean" &&
    settings.fx.method === "median" && integer(settings.fx.window_seconds) && settings.fx.window_seconds > 0);
  requireValue(object(record.windows) && object(record.gas_basis));
  networkWindow(record.windows.storage, settings.storage, asOf);
  networkWindow(record.windows.gas_recent, settings.gas.recent, asOf);
  networkWindow(record.windows.gas_fallback, settings.gas.fallback, asOf);
  for (const method of ["single", "batch"]) requireValue(["recent", "fallback"].includes(record.gas_basis[method]));

  const fx = record.exchange_reference;
  requireValue(object(fx) && fx.source === "CoinGecko" && fx.method === settings.fx.method);
  requireValue(integer(fx.window_start) && integer(fx.window_end) && fx.window_end <= generated &&
    Number.isSafeInteger(settings.fx.window_seconds * 1000) &&
    fx.window_end - fx.window_start === settings.fx.window_seconds * 1000);
  requireValue(object(fx.exchange) && object(fx.samples));
  for (const key of ["ant_usd", "eth_usd"]) {
    requireValue(positive(fx.exchange[key]) && object(fx.samples[key]));
    const sample = fx.samples[key];
    url(sample.source_url);
    requireValue(integer(sample.first_sample_at) && integer(sample.last_sample_at) &&
      fx.window_start <= sample.first_sample_at && sample.first_sample_at <= sample.last_sample_at &&
      sample.last_sample_at <= fx.window_end);
  }
  requireValue(Array.isArray(record.examples) && record.examples.length === 3);
  for (const [index, example] of record.examples.entries()) {
    requireValue(object(example) && example.amount === "1" && example.unit === ["MB", "GB", "TB"][index] &&
      example.method === (index === 0 ? "single" : "batch") &&
      example.billing_unit === (index === 0 ? "chunk" : "batch_leaf"));
    requireValue(typeof example.billed_units === "string" && /^[1-9]\d{0,23}$/.test(example.billed_units));
    for (const key of ["storage_ant", "transaction_fee_eth", "storage_usd", "transaction_fee_usd", "total_usd"]) {
      requireValue(positive(example[key], MONEY));
    }
  }
  requireValue(text(record.normalization) && object(record.guidance) &&
    text(record.guidance.command) && text(record.guidance.description));
  for (const key of ["assumptions", "exclusions"]) {
    requireValue(Array.isArray(record[key]) && record[key].length > 0 && record[key].every(text));
  }
}

async function readEnvelope(kv) {
  let reader;
  let expired = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("Pricing read timed out"));
    }, 2000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const stream = await kv.get("pricing:v1", { type: "stream" });
      requireValue(stream && typeof stream.getReader === "function");
      if (expired) {
        void stream.cancel().catch(() => {});
        throw new Error("Pricing read timed out");
      }
      reader = stream.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let body = "";
      while (!expired) {
        const { done, value } = await reader.read();
        if (done) return JSON.parse(body + decoder.decode());
        bytes += value.byteLength;
        requireValue(bytes <= 65536);
        body += decoder.decode(value, { stream: true });
      }
      throw new Error("Pricing read timed out");
    })()]);
  } finally {
    clearTimeout(timer);
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function handlePricing(request, env) {
  const response = (body, status) => new Response(body, { status, headers: HEADERS });
  if (request.method === "OPTIONS") return response(null, 204);
  if (request.method !== "GET") {
    return response(request.method === "HEAD" ? null : '{"error":"method_not_allowed"}', 405);
  }
  try {
    const envelope = await readEnvelope(env?.PRICING_KV);
    validate(envelope);
    return response(JSON.stringify(envelope), 200);
  } catch {
    return response('{"error":"pricing_unavailable"}', 503);
  }
}
