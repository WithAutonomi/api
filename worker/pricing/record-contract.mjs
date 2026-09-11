// Platform-neutral public-record contract. No evidence, collector, filesystem or
// network imports: API/site consumers can validate without shipping the producer.
import { MODEL, amountToBytes, summarizeUpload } from './model.mjs';

export const PROVENANCE = 'production-daily-v1';
export const DAY = 86_400_000;
export const RECORD_BYTES = 65_536;
export const ANT_REPORT = Object.freeze({
  name: 'ant.report',
  payment_url: 'https://www.ant.report/api/v1/payment?window_secs=604800&sections=overall,volume,methods,store_cost,total_cost',
  meta_url: 'https://www.ant.report/api/v1/meta',
  formula_url: 'https://www.ant.report/assets/index-Buh_61Rf.js',
  formula_sha256: '930d24735de32101d2cb5ff165f302a0e7d97390473eaa7406c8a71f43962932',
  request_window_seconds: 604800,
});
export const COINGECKO = Object.freeze({
  ant_usd: 'https://api.coingecko.com/api/v3/coins/autonomi/market_chart?vs_currency=usd&days=1',
  eth_usd: 'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=1',
});
export const NORMALIZATION = 'Sum shortest round-trippable source Number decimals exactly; normalize per-unit ratios once to 24 fractional digits, half-up; thereafter round only for display.';
export const ASSUMPTIONS = Object.freeze([
  'One logical upload; all source chunks require payment. Decimal MB, GB and TB; reviewed client billing and automatic method selection.',
  'Storage uses complete returned daily buckets from the provider seven-day request, not seven complete UTC days.',
  'Gas uses each method’s billed-unit reference from hourly buckets at or after the latest returned bucket minus 86400 seconds; no activity falls back to the same seven-day daily reference.',
  'The dated 24-hour currency median is a reference, not a live quote. Prefer live website currency lookup; fallback expires 48 hours after window end.',
]);
export const COMMON_LIMITS = Object.freeze([
  'Indicative, not an exact or guaranteed upload cost. Use official client tooling for a file-specific estimate.',
  'Provider gas may be a lower bound for intermediary-contract transactions, even with complete reported gas coverage.',
  'Excludes DataMap overhead, deduplication, runtime fallback and wallet-allowance approval fees.',
  'No network-fullness multiplier, mixed-method weighting, quote multiplier or gas floor. New reference prices do not renew the client calculation review.',
]);
export const DAILY_LIMIT = 'Daily reference; original observation and currency windows determine eligibility.';
export const CAPTURE_FIELDS = Object.freeze(['repository', 'ref', 'head_sha', 'run_id', 'run_attempt', 'event', 'captured_at']);
export const AGGREGATE_FIELDS = Object.freeze(['total_ant', 'total_gas_eth', 'billed_units', 'txns', 'gas_covered_txns', 'active_bucket_timestamps']);
export const RATE_FIELDS = Object.freeze(['single_ant_per_chunk', 'single_eth_per_chunk', 'batch_ant_per_leaf', 'batch_eth_per_leaf']);

export function requireValue(condition) {
  if (!condition) throw new Error('Invalid pricing contract');
}
export function keys(value, expected) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)));
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}
export function milliseconds(value) {
  integer(value, 1, 253402300799999); // Last millisecond with a four-digit year.
  return value;
}
export function date(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  const ms = milliseconds(Date.parse(value));
  requireValue(new Date(ms).toISOString() === value);
  return ms;
}
export function iso(value) { return new Date(milliseconds(value)).toISOString(); }
export function revision(value) { requireValue(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)); return value; }
export function digest(value) { requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value; }
export function runId(value) { requireValue(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)); return value; }
export function count(value) {
  requireValue(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(value));
  return BigInt(value);
}
export function decimal(value, max) {
  requireValue(typeof value === 'string' && value.length <= max && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value));
  return BigInt(value.replace('.', ''));
}
export function rate(value) {
  requireValue(decimal(value, 49) > 0n);
  const [whole, fraction = ''] = value.split('.');
  requireValue(whole.length <= 24 && fraction.length <= 24);
}
export function same(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (Array.isArray(expected)) {
      requireValue(Array.isArray(actual) && actual.length === expected.length);
    } else keys(actual, Object.keys(expected));
    for (const key of Object.keys(expected)) same(actual[key], expected[key]);
  } else requireValue(actual === expected);
}
export function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
export function parseCanonical(bytes, max = RECORD_BYTES) {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= max);
  // ignoreBOM means decode it rather than silently stripping it; JSON then fails.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  requireValue(serialize(value) === text); // Also rejects duplicate keys, -0 and lossy number spellings.
  return value;
}

export function validateCapture(capture, withDigest = false) {
  keys(capture, withDigest ? [...CAPTURE_FIELDS, 'sha256'] : CAPTURE_FIELDS);
  requireValue(capture.repository === 'WithAutonomi/inventory' && capture.ref === 'refs/heads/main'
    && capture.run_attempt === '1' && ['schedule', 'workflow_dispatch'].includes(capture.event));
  revision(capture.head_sha); runId(capture.run_id); date(capture.captured_at);
  if (withDigest) digest(capture.sha256);
}
export function validateSource(source, generatedAt) {
  keys(source, [...Object.keys(ANT_REPORT), 'capture', 'provider_generated_at', 'metadata_generated_at', 'data_as_of', 'provenance']);
  for (const key of Object.keys(ANT_REPORT)) requireValue(source[key] === ANT_REPORT[key]);
  requireValue(source.provenance === PROVENANCE);
  validateCapture(source.capture, true);
  const generated = date(generatedAt);
  for (const value of [source.provider_generated_at, source.metadata_generated_at, source.data_as_of, source.capture.captured_at]) {
    requireValue(date(value) <= generated);
  }
  requireValue(date(source.data_as_of) <= date(source.provider_generated_at));
}

export function validateWindow(window, seconds, span, source) {
  keys(window, ['bucket_seconds', 'cutoff_unix', 'latest_returned_bucket_unix', 'bucket_timestamps']);
  requireValue(window.bucket_seconds === seconds);
  const latest = integer(window.latest_returned_bucket_unix, 1);
  milliseconds(latest * 1000);
  integer(window.cutoff_unix, 1);
  requireValue(window.cutoff_unix === latest - span && latest * 1000 <= date(source.data_as_of));
  const times = window.bucket_timestamps;
  requireValue(Array.isArray(times) && times.length > 0 && times.length <= 512 && times.at(-1) === latest);
  const lower = Math.floor((date(source.provider_generated_at) / 1000 - 604800) / seconds) * seconds;
  times.forEach((ts, i) => {
    integer(ts, 1); milliseconds(ts * 1000);
    requireValue(ts % seconds === 0 && ts >= Math.max(lower, window.cutoff_unix) && (i === 0 || ts > times[i - 1]));
  });
}
export function validateAggregateValues(record, window) {
  const units = count(record.billed_units), txns = count(record.txns), covered = count(record.gas_covered_txns);
  const ant = decimal(record.total_ant, 350), gas = decimal(record.total_gas_eth, 350);
  requireValue(txns === covered && txns <= units);
  requireValue(units > 0n ? txns > 0n && ant > 0n && gas > 0n : txns === 0n && ant === 0n && gas === 0n);
  const active = record.active_bucket_timestamps, times = window.bucket_timestamps;
  requireValue(Array.isArray(active) && active.length <= times.length
    && (units > 0n ? active.length > 0 && BigInt(active.length) <= txns : active.length === 0)
    && active.every((ts, i) => times.includes(ts) && (i === 0 || ts > active[i - 1])));
}
export function validateExchange(reference) {
  keys(reference, ['method', 'source', 'window_start', 'window_end', 'expires_at', 'exchange', 'samples']);
  requireValue(reference.method === 'median-24h' && reference.source === 'CoinGecko');
  const end = milliseconds(reference.window_end);
  milliseconds(reference.window_start); milliseconds(reference.expires_at);
  requireValue(reference.window_start === end - DAY && reference.expires_at === end + 2 * DAY);
  keys(reference.exchange, Object.keys(COINGECKO)); keys(reference.samples, Object.keys(COINGECKO));
  for (const key of Object.keys(COINGECKO)) {
    rate(reference.exchange[key]);
    const sample = reference.samples[key];
    keys(sample, ['source_url', 'sample_count', 'first_sample_at', 'last_sample_at', 'max_gap_ms']);
    requireValue(sample.source_url === COINGECKO[key]);
    integer(sample.sample_count, 200, 400);
    integer(sample.first_sample_at, end - DAY, end - DAY + 900000);
    integer(sample.last_sample_at, end - 900000, end);
    integer(sample.max_gap_ms, 1, 900000);
    requireValue(sample.last_sample_at - sample.first_sample_at <= sample.max_gap_ms * (sample.sample_count - 1));
  }
}

export function validateProductionRecord(record) {
  keys(record, ['schema_version', 'kind', 'generated_at', 'source', 'calculation', 'rates', 'storage_reference',
    'gas_reference', 'exchange_reference', 'examples', 'normalization', 'assumptions', 'limits']);
  requireValue(record.schema_version === 1 && record.kind === 'indicative-upload-pricing');
  validateSource(record.source, record.generated_at);
  same(record.calculation, MODEL);
  keys(record.rates, RATE_FIELDS);
  for (const value of Object.values(record.rates)) rate(value); // Never only the selected method.
  keys(record.storage_reference, ['single', 'batch']); keys(record.gas_reference, ['single', 'batch']);
  for (const method of ['single', 'batch']) {
    const storage = record.storage_reference[method], gas = record.gas_reference[method];
    keys(storage, [...AGGREGATE_FIELDS, 'window']);
    validateWindow(storage.window, 86400, 604800, record.source);
    validateAggregateValues(storage, storage.window);
    requireValue(count(storage.billed_units) > 0n);
    keys(gas, [...AGGREGATE_FIELDS, 'window', 'selection', 'recent_day_billed_units']);
    const recent = count(gas.recent_day_billed_units) > 0n;
    requireValue(gas.selection === (recent ? 'recent-day-hourly' : 'seven-day-daily-fallback'));
    validateWindow(gas.window, recent ? 3600 : 86400, recent ? 86400 : 604800, record.source);
    validateAggregateValues(gas, gas.window);
    requireValue(count(gas.billed_units) > 0n);
    if (recent) requireValue(gas.recent_day_billed_units === gas.billed_units);
    else for (const key of [...AGGREGATE_FIELDS, 'window']) same(gas[key], storage[key]);
  }
  same(record.storage_reference.single.window, record.storage_reference.batch.window);
  if (record.gas_reference.single.selection === 'recent-day-hourly' && record.gas_reference.batch.selection === 'recent-day-hourly') {
    same(record.gas_reference.single.window, record.gas_reference.batch.window);
  }
  validateExchange(record.exchange_reference);
  requireValue(record.exchange_reference.window_end <= date(record.generated_at));
  requireValue(Array.isArray(record.examples) && record.examples.length === 3);
  record.examples.forEach((example, i) => {
    const unit = ['MB', 'GB', 'TB'][i];
    const summary = summarizeUpload(amountToBytes('1', unit));
    keys(example, ['amount', 'unit', ...Object.keys(summary), 'storage_ant', 'transaction_fee_eth', 'storage_usd', 'transaction_fee_usd', 'total_usd']);
    requireValue(example.amount === '1' && example.unit === unit);
    for (const key of Object.keys(summary)) same(example[key], summary[key]);
    for (const key of ['storage_ant', 'transaction_fee_eth']) decimal(example[key], 64);
    for (const key of ['storage_usd', 'transaction_fee_usd', 'total_usd']) decimal(example[key], 256);
  });
  requireValue(record.normalization === NORMALIZATION);
  same(record.assumptions, ASSUMPTIONS); same(record.limits, [...COMMON_LIMITS, DAILY_LIMIT]);
  requireValue(new TextEncoder().encode(serialize(record)).byteLength <= RECORD_BYTES);
  return record;
}

export function parseProductionRecord(bytes) { return validateProductionRecord(parseCanonical(bytes)); }

// Separate from historical validation: never refresh or rewrite a recorded date.
export function productionEligibility(record, now) {
  validateProductionRecord(record); milliseconds(now);
  const clockValid = [record.generated_at, record.source.data_as_of, record.source.provider_generated_at,
    record.source.metadata_generated_at, record.source.capture.captured_at].every(value => date(value) <= now + 60000);
  const native = clockValid && now <= date(record.source.data_as_of) + 7 * DAY;
  const reference = clockValid && now >= record.exchange_reference.window_end && now <= record.exchange_reference.expires_at;
  return { native, reference, publish_eligible: native && reference };
}
