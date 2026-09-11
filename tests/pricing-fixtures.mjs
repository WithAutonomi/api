// SYNTHETIC / TEST ONLY. No observations, evidence or publication occurred.
// Repeated-letter revisions/hashes and all monetary inputs below are invented.
// Imported only by tests, never by the Worker or deployment configuration.
import { createHash } from 'node:crypto';
import { MODEL, amountToBytes, estimateUpload, convertToUsd } from '../worker/pricing/model.mjs';
import { ANT_REPORT, COINGECKO, NORMALIZATION, ASSUMPTIONS, COMMON_LIMITS, DAILY_LIMIT } from '../worker/pricing/record-contract.mjs';

export const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const DAY = 86_400_000;
export const NATIVE_END = NOW + 7 * DAY;
export const REFERENCE_END = NOW - 60000 + 2 * DAY;
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const encode = value => new TextEncoder().encode(value);
export const canonical = value => encode(`${JSON.stringify(value, null, 2)}\n`);

export function syntheticRecord() {
  const daily = NOW / 1000 - 43200;
  const hourly = NOW / 1000;
  const window = (latest, bucket_seconds, span) => ({
    bucket_seconds, cutoff_unix: latest - span,
    latest_returned_bucket_unix: latest, bucket_timestamps: [latest],
  });
  const aggregate = (total_ant, total_gas_eth, latest, bucket_seconds, span) => ({
    total_ant, total_gas_eth, billed_units: '100', txns: '1', gas_covered_txns: '1',
    active_bucket_timestamps: [latest], window: window(latest, bucket_seconds, span),
  });
  const single = aggregate('1', '0.01', daily, 86400, 604800);
  const batch = aggregate('2', '0.003', daily, 86400, 604800);
  const rates = {
    single_ant_per_chunk: '0.01', single_eth_per_chunk: '0.0002',
    batch_ant_per_leaf: '0.02', batch_eth_per_leaf: '0.00003',
  };
  const exchange = { ant_usd: '0.5', eth_usd: '2000' };
  const end = NOW - 60000;
  return {
    schema_version: 1,
    kind: 'indicative-upload-pricing',
    generated_at: new Date(NOW).toISOString(),
    source: {
      ...ANT_REPORT,
      capture: {
        repository: 'WithAutonomi/inventory', ref: 'refs/heads/main', head_sha: 'a'.repeat(40),
        run_id: '123', run_attempt: '1', event: 'schedule', sha256: 'b'.repeat(64),
        captured_at: new Date(NOW).toISOString(),
      },
      provider_generated_at: new Date(NOW).toISOString(),
      metadata_generated_at: new Date(NOW).toISOString(),
      data_as_of: new Date(NOW).toISOString(),
      provenance: 'production-daily-v1',
    },
    calculation: structuredClone(MODEL),
    rates,
    storage_reference: { single, batch },
    gas_reference: {
      single: { ...aggregate('1', '0.02', hourly, 3600, 86400),
        selection: 'recent-day-hourly', recent_day_billed_units: '100' },
      batch: { ...structuredClone(batch), selection: 'seven-day-daily-fallback', recent_day_billed_units: '0' },
    },
    exchange_reference: {
      method: 'median-24h', source: 'CoinGecko', window_start: end - DAY,
      window_end: end, expires_at: end + 2 * DAY, exchange,
      samples: Object.fromEntries(Object.entries(COINGECKO).map(([key, source_url]) => [key, {
        source_url, sample_count: 289, first_sample_at: end - DAY, last_sample_at: end, max_gap_ms: 300000,
      }])),
    },
    examples: ['MB', 'GB', 'TB'].map(unit => {
      const native = estimateUpload(amountToBytes('1', unit), rates);
      return { amount: '1', unit, ...native, ...convertToUsd(native.storage_ant, native.transaction_fee_eth, exchange) };
    }),
    normalization: NORMALIZATION,
    assumptions: [...ASSUMPTIONS],
    limits: [...COMMON_LIMITS, DAILY_LIMIT],
  };
}

export function publication(record = syntheticRecord(), bytes = canonical(record)) {
  return {
    bytes,
    metadata: {
      schema_version: 1, data_revision: 'c'.repeat(40), payload_sha256: sha256(bytes),
      evidence_sha256: record.source.capture.sha256, producer_revision: record.source.capture.head_sha,
      verifier_revision: 'd'.repeat(40), publication_run_id: '456', publication_run_attempt: '1',
      published_at: new Date(NOW).toISOString(),
    },
  };
}

export function storage(fixture = publication()) {
  const calls = [];
  return {
    calls,
    env: { PRICING_KV: { async getWithMetadata(...args) {
      calls.push(args);
      return { value: new Response(fixture.bytes).body, metadata: structuredClone(fixture.metadata) };
    } } },
  };
}

export function forbidNetwork(t) {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No external requests in pricing/discovery tests'); });
  const log = t.mock.method(console, 'error', () => {});
  const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  let cacheReads = 0;
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() {
    cacheReads++;
    throw new Error('No pricing Cache API');
  } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'caches', original);
    else delete globalThis.caches;
    assertNoCalls();
  });
  function assertNoCalls() {
    // Do not let a caught exception hide an unwanted network/cache/log attempt.
    if (fetch.mock.callCount() || log.mock.callCount() || cacheReads) {
      throw new Error('Unexpected pricing/discovery network, cache or log access');
    }
  }
}
