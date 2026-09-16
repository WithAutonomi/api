import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { forbidIO, loadWorker, request, reply } from './helpers.mjs';

const worker = await loadWorker();
const record = JSON.parse(readFileSync(new URL('./fixtures/pricing.json', import.meta.url)));
// Publication metadata here is synthetic, not a claim that this record was published.
const envelope = () => ({ record: structuredClone(record), data_revision: 'a'.repeat(40),
  payload_sha256: 'b'.repeat(64), published_at: '2026-09-09T00:00:00.000Z' });
const headers = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type', allow: 'GET, OPTIONS',
  'x-content-type-options': 'nosniff',
};
function kv(t, get) {
  forbidIO(t);
  let reads = 0;
  t.after(() => assert.equal(reads, 1));
  return { PRICING_KV: { get(key, options) {
    reads++;
    assert.equal(key, 'pricing:v1');
    assert.deepEqual(options, { type: 'stream' });
    return get();
  } } };
}
async function serve(t, value) {
  return worker.fetch(request('/api/pricing///?ignored=1'), kv(t, () => new Response(JSON.stringify(value)).body));
}
async function unavailable(response) {
  assert.deepEqual(await reply(response), { status: 503, headers, body: '{"error":"pricing_unavailable"}' });
}

test('one read serves the complete dated record indefinitely, with no provider calls or hash verification', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2040-01-01T00:00:00.000Z'));
  const value = envelope();
  assert.deepEqual(await reply(await serve(t, value)), { status: 200, headers, body: JSON.stringify(value) });
});
test('diagnostic and cosmetic changes do not reject or alter a usable envelope', async t => {
  const value = envelope();
  value.extra = { ignored: true };
  value.data_revision = 'abcdef0';
  value.payload_sha256 = null;
  value.published_at = 'not a date';
  value.record.generated_at = '2099-01-01T00:00:00.000Z';
  value.record.source.name = 'ant.report v2';
  value.record.source.captured_at = '2026-02-30T00:00:00.000Z';
  value.record.source.provider_generated_at = 'not a date';
  value.record.source.metadata_generated_at = '2099-01-01T00:00:00.000Z';
  value.record.source.payment_url = 'not a URL';
  value.record.calculation.client_version = '0.3.7';
  value.record.calculation.client_revision = 'updated';
  value.record.calculation.calculation_id = 'updated label';
  value.record.calculation.source_chunk_bytes = '4194304';
  value.record.calculation.amount_unit_bytes.GB = '1073741824';
  value.record.calculation.extra = 'future explanation';
  value.record.calculation.amount_unit_bytes.extra = 'ignored';
  value.record.examples[0].total_usd = 123;
  value.record.examples.push({ description: 'fourth example' });
  value.record.assumptions = [];
  value.record.exclusions = [''];
  delete value.record.guidance;
  value.record.source.provenance = 'scheduled-collector';
  const response = await serve(t, value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), value);
});
test('unused settings, windows, gas basis and FX evidence do not gate serving', async t => {
  const value = envelope();
  const r = value.record;
  r.settings.storage.window_seconds++;
  r.settings.gas.fallback.window_seconds++;
  r.settings.gas.recent.bucket_seconds = 1800;
  r.settings.fx.window_seconds = 0;
  r.settings.storage.method = 'median';
  r.windows.storage.bucket_timestamps = [0, 0];
  r.windows.gas_recent.bucket_timestamps[0]++;
  r.windows.gas_fallback.bucket_timestamps = [];
  r.gas_basis = { single: 'fallback', batch: 'storage' };
  r.exchange_reference.source = 'updated provider label';
  r.exchange_reference.method = 'mean';
  r.exchange_reference.window_start = r.exchange_reference.window_end + 1;
  r.exchange_reference.samples.ant_usd.first_sample_at = r.exchange_reference.window_end;
  r.exchange_reference.samples.eth_usd.last_sample_at = r.exchange_reference.window_end + 1;
  delete r.exchange_reference.samples.eth_usd.source_url;
  const response = await serve(t, value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), value);
});
test('only the required record core is needed; dates allow exactly 60 seconds future', async t => {
  const now = Date.parse('2026-09-09T00:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const value = { record: {
    schema_version: 1, kind: 'upload-pricing-reference',
    calculation: { calculation_version: '2' },
    source: { data_as_of: new Date(now + 60000).toISOString() },
    rates: record.rates,
    exchange_reference: { window_end: now + 60000, exchange: record.exchange_reference.exchange },
  } };
  const response = await serve(t, value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), value);
});

for (const [name, change] of [
  ['non-object', e => { e.record = []; }],
  ['missing field', e => { delete e.record.rates.single_ant_per_chunk; }],
  ['wrong kind', e => { e.record.kind = 'indicative-upload-pricing'; }],
  ['wrong schema type', e => { e.record.schema_version = '1'; }],
  ['unsupported calculation', e => { e.record.calculation.calculation_version = '3'; }],
  ['numeric calculation version', e => { e.record.calculation.calculation_version = 2; }],
  ['impossible calendar date', e => { e.record.source.data_as_of = '2026-02-30T00:00:00.000Z'; }],
  ['non-UTC date', e => { e.record.source.data_as_of = '2026-09-08T18:14:19+00:00'; }],
  ['future source date', e => { e.record.source.data_as_of = new Date(Date.now() + 60001).toISOString(); }],
  ['future FX date', e => { e.record.exchange_reference.window_end = Date.now() + 60001; }],
  ['nonpositive FX date', e => { e.record.exchange_reference.window_end = 0; }],
  ['noninteger FX date', e => { e.record.exchange_reference.window_end += 0.5; }],
  ['string FX date', e => { e.record.exchange_reference.window_end = String(e.record.exchange_reference.window_end); }],
]) {
  test(`rejects ${name}`, async t => {
    t.mock.method(Date, 'now', () => Date.parse('2026-09-09T00:00:00.000Z'));
    const value = envelope(); change(value);
    await unavailable(await serve(t, value));
  });
}
test('all six required rates reject nonpositive, numeric, exponent, whitespace and overprecision values', async t => {
  forbidIO(t);
  for (const group of ['rates', 'exchange']) {
    const keys = Object.keys(group === 'rates' ? record.rates : record.exchange_reference.exchange);
    for (const key of keys) for (const bad of ['0', '-1', 1, '1e-8', ' 1', '1\n', '0.' + '0'.repeat(24) + '1', '1'.repeat(25)]) {
      const value = envelope();
      (group === 'rates' ? value.record.rates : value.record.exchange_reference.exchange)[key] = bad;
      await unavailable(await worker.fetch(request('/api/pricing'), {
        PRICING_KV: { get: () => new Response(JSON.stringify(value)).body },
      }));
    }
  }
});
test('method handling never reads KV or providers', async t => {
  const env = forbidIO(t);
  for (const method of ['OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(await reply(await worker.fetch(request('/api/pricing', method), env)), {
      status: method === 'OPTIONS' ? 204 : 405, headers,
      body: ['OPTIONS', 'HEAD'].includes(method) ? '' : '{"error":"method_not_allowed"}',
    });
  }
});
test('missing binding is unavailable without supply-provider access', async t => {
  forbidIO(t);
  await unavailable(await worker.fetch(request('/api/pricing')));
});
for (const [name, get] of [
  ['missing key', () => null], ['read error', () => { throw new Error('private fixture error'); }],
  ['malformed JSON', () => new Response('{').body],
  ['wrong JSON shape', () => new Response('null').body],
  ['body error', () => new ReadableStream({ start(c) { c.error(new Error('body error')); } })],
  ['invalid UTF-8', () => new Response(new Uint8Array([255])).body],
  ['oversized UTF-8 body', () => new Response('é'.repeat(32769)).body],
]) test(name, async t => { await unavailable(await worker.fetch(request('/api/pricing'), kv(t, get))); });
test('exact 65,536-byte boundary is accepted, including split UTF-8', async t => {
  const value = envelope(); value.extra = 'é';
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json + ' '.repeat(65536 - Buffer.byteLength(json)));
  const split = bytes.indexOf(195) + 1;
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); } });
  const response = await worker.fetch(request('/api/pricing'), kv(t, () => stream));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), value);
});
for (const phase of ['lookup', 'body']) test(`two-second bound covers stalled ${phase} and cancels late streams`, async t => {
  let resolve;
  let cancelled = 0;
  const stream = new ReadableStream({ cancel() { cancelled++; } });
  const get = phase === 'lookup' ? () => new Promise(r => { resolve = r; }) : () => stream;
  const start = performance.now();
  await unavailable(await worker.fetch(request('/api/pricing'), kv(t, get)));
  assert.ok(performance.now() - start >= 1900);
  assert.ok(performance.now() - start < 4000);
  if (resolve) resolve(stream);
  await new Promise(r => setImmediate(r));
  assert.equal(cancelled, 1);
});
