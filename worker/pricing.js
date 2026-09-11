// Published-record reader only. Supply's providers and stale caches stay separate.
import {
  DAY, RECORD_BYTES, date, digest, iso, keys, milliseconds,
  parseProductionRecord, requireValue, revision, runId,
} from "./pricing/record-contract.mjs";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Allow": "GET, OPTIONS",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Expose-Headers": "X-Pricing-Revision, X-Pricing-SHA256, X-Pricing-Published-At, X-Pricing-Native-Expires-At, X-Pricing-Reference-State, X-Pricing-Reference-Expires-At",
};

function response(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: { ...HEADERS, "Cache-Control": "no-store", ...headers },
  });
}

function validateMetadata(metadata) {
  keys(metadata, ["schema_version", "data_revision", "payload_sha256", "evidence_sha256",
    "producer_revision", "verifier_revision", "publication_run_id", "publication_run_attempt", "published_at"]);
  requireValue(new TextEncoder().encode(JSON.stringify(metadata)).byteLength <= 1024);
  requireValue(metadata.schema_version === 1 && metadata.publication_run_attempt === "1");
  for (const key of ["data_revision", "producer_revision", "verifier_revision"]) revision(metadata[key]);
  digest(metadata.payload_sha256); digest(metadata.evidence_sha256);
  runId(metadata.publication_run_id); date(metadata.published_at);
}

async function readPublished(env) {
  let reader;
  let timedOut = false;
  let timer;
  // Cancellation is best effort. Neither a stalled cancel nor a late KV result
  // may hold the response open beyond the single read/body deadline.
  function cancel() {
    try { reader?.cancel().catch(() => {}); } catch {}
  }
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      cancel();
      reject(new Error("Pricing read deadline"));
    }, 2000);
  });
  async function read() {
    const stored = await env.PRICING_KV.getWithMetadata("pricing:v1", { type: "stream", cacheTtl: 60 });
    reader = stored.value.getReader();
    if (timedOut) {
      cancel();
      throw new Error("Pricing read deadline");
    }
    validateMetadata(stored.metadata);
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      requireValue(!timedOut);
      if (done) break;
      requireValue(value instanceof Uint8Array);
      length += value.byteLength;
      requireValue(length <= RECORD_BYTES);
      chunks.push(value);
    }
    reader.releaseLock();
    reader = undefined;
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    requireValue(hash === stored.metadata.payload_sha256);
    const record = parseProductionRecord(bytes);
    requireValue(stored.metadata.evidence_sha256 === record.source.capture.sha256
      && stored.metadata.producer_revision === record.source.capture.head_sha
      && date(record.generated_at) <= date(stored.metadata.published_at));
    return { bytes, record, metadata: stored.metadata };
  }
  try {
    return await Promise.race([read(), deadline]);
  } catch (error) {
    cancel();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function handlePricing(request, env) {
  if (request.method === "OPTIONS") return response(null, 204);
  if (request.method !== "GET") {
    return response(request.method === "HEAD" ? null : '{"error":"method_not_allowed"}', 405);
  }
  try {
    const { bytes, record, metadata } = await readPublished(env);
    // Check the serving clock after all asynchronous work. A read/publication
    // time cannot renew the record, and future reference windows are not expiry.
    const now = milliseconds(Date.now());
    requireValue([record.generated_at, record.source.data_as_of, record.source.provider_generated_at,
      record.source.metadata_generated_at, record.source.capture.captured_at, metadata.published_at]
      .every(value => date(value) <= now + 60000));
    const nativeEnd = date(record.source.data_as_of) + 7 * DAY;
    const referenceEnd = record.exchange_reference.expires_at;
    requireValue(now <= nativeEnd && record.exchange_reference.window_end <= now);
    const referenceValid = now <= referenceEnd;
    const boundary = referenceValid ? Math.min(nativeEnd, referenceEnd) : nativeEnd;
    const ttl = Math.max(0, Math.min(60, Math.floor((boundary - now) / 1000)));
    return response(bytes, 200, {
      "Cache-Control": `public, max-age=${ttl}, must-revalidate`,
      "X-Pricing-Revision": metadata.data_revision,
      "X-Pricing-SHA256": metadata.payload_sha256,
      "X-Pricing-Published-At": metadata.published_at,
      "X-Pricing-Native-Expires-At": iso(nativeEnd),
      "X-Pricing-Reference-State": referenceValid ? "valid" : "expired",
      "X-Pricing-Reference-Expires-At": iso(referenceEnd),
    });
  } catch {
    // Fixed failure, no raw storage/record/exception logging and no fallback.
    return response('{"error":"pricing_unavailable"}', 503);
  }
}
