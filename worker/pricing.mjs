// Inventory validates the full record. This reader checks only required rates, dates and version.
const RATE = /^(0|[1-9]\d{0,23})(\.\d{1,24})?$/;
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
const positive = value => typeof value === "string" && value.length <= 49 &&
  value.trim() === value && RATE.test(value) && /[1-9]/.test(value);

function date(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value));
  const time = Date.parse(value);
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  requireValue(Number.isFinite(time) && new Date(time).toISOString() === normalized);
  return time;
}

function validate(envelope) {
  requireValue(object(envelope) && object(envelope.record));
  const record = envelope.record;
  requireValue(record.schema_version === 1 && record.kind === "upload-pricing-reference");
  requireValue(object(record.calculation) && record.calculation.calculation_version === "2");
  const latest = Date.now() + 60000;
  requireValue(object(record.source) && date(record.source.data_as_of) <= latest);
  requireValue(object(record.rates));
  for (const key of ["single_ant_per_chunk", "single_eth_per_chunk", "batch_ant_per_leaf", "batch_eth_per_leaf"]) {
    requireValue(positive(record.rates[key]));
  }
  const fx = record.exchange_reference;
  requireValue(object(fx) && Number.isSafeInteger(fx.window_end) && fx.window_end > 0 &&
    Number.isFinite(new Date(fx.window_end).getTime()) && fx.window_end <= latest);
  requireValue(object(fx.exchange));
  for (const key of ["ant_usd", "eth_usd"]) {
    requireValue(positive(fx.exchange[key]));
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
