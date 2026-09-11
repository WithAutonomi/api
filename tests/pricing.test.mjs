import assert from 'node:assert/strict';
import test from 'node:test';
import { NOW, NATIVE_END, REFERENCE_END, canonical, encode, forbidNetwork,
  publication, storage, syntheticRecord } from './pricing-fixtures.mjs';
import { CIRCULATING, DETAILED, JSON_HEADERS, SUPPLY_HEADERS, TEXT_HEADERS } from './fixtures.mjs';
import { assertJsonReply, assertReply, harness } from './helpers.mjs';

// Let Node report the unchanged package's module warning before spying on
// handler logs. The warning remains visible; pricing exceptions must not be.
const worker = (await import('../worker/index.js')).default;
await new Promise(resolve => setImmediate(resolve));

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  allow: 'GET, OPTIONS',
  'x-content-type-options': 'nosniff',
  'access-control-expose-headers': 'X-Pricing-Revision, X-Pricing-SHA256, X-Pricing-Published-At, X-Pricing-Native-Expires-At, X-Pricing-Reference-State, X-Pricing-Reference-Expires-At',
};
const request = (env, method = 'GET', path = '/api/pricing', headers) =>
  worker.fetch(new Request(`https://api.example.test${path}`, { method, headers }), env);

function offline(t, now = NOW) {
  forbidNetwork(t);
  t.mock.method(Date, 'now', () => now);
}

async function unavailable(response) {
  await assertReply(response, {
    status: 503, headers: { ...HEADERS, 'cache-control': 'no-store' }, body: '{"error":"pricing_unavailable"}',
  });
}

async function success(response, fixture, { ttl = 60, reference = 'valid' } = {}) {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.fromEntries(response.headers), {
    ...HEADERS,
    'cache-control': `public, max-age=${ttl}, must-revalidate`,
    'x-pricing-revision': fixture.metadata.data_revision,
    'x-pricing-sha256': fixture.metadata.payload_sha256,
    'x-pricing-published-at': fixture.metadata.published_at,
    'x-pricing-native-expires-at': new Date(NATIVE_END).toISOString(),
    'x-pricing-reference-state': reference,
    'x-pricing-reference-expires-at': new Date(REFERENCE_END).toISOString(),
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), fixture.bytes);
}

test('pricing returns exact synthetic bytes and headers with one fixed KV stream read per GET', async t => {
  offline(t);
  const fixture = publication();
  const kv = storage(fixture);
  kv.env.PRICING_KV.getWithMetadata = async (...args) => {
    kv.calls.push(args);
    return { metadata: structuredClone(fixture.metadata), value: new ReadableStream({ start(controller) {
      // Exercise assembly beyond offset zero without changing the expected bytes.
      controller.enqueue(fixture.bytes.subarray(0, 17));
      controller.enqueue(fixture.bytes.subarray(17));
      controller.close();
    } }) };
  };
  await success(await request(kv.env), fixture);
  // Conditional headers/query parameters do not select a key, version or 304.
  await success(await request(kv.env, 'GET', '/api/pricing///?key=other&provider=other', {
    'If-None-Match': '*', 'If-Modified-Since': new Date(NOW).toUTCString(), Accept: 'text/plain',
  }), fixture);
  assert.deepEqual(kv.calls, Array(2).fill(['pricing:v1', { type: 'stream', cacheTtl: 60 }]));
});

test('pricing OPTIONS/other methods never inspect binding or body; HEAD is bodyless', async t => {
  offline(t);
  let accesses = 0;
  const env = { get PRICING_KV() { accesses++; throw new Error('Must not inspect'); } };
  for (const method of ['OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    await assertReply(await request(env, method), {
      status: method === 'OPTIONS' ? 204 : 405,
      headers: { ...HEADERS, 'cache-control': 'no-store' },
      body: ['OPTIONS', 'HEAD'].includes(method) ? '' : '{"error":"method_not_allowed"}',
    });
  }
  const post = new Request('https://api.example.test/api/pricing', { method: 'POST', body: 'not JSON' });
  await assertReply(await worker.fetch(post, env), {
    status: 405, headers: { ...HEADERS, 'cache-control': 'no-store' }, body: '{"error":"method_not_allowed"}',
  });
  assert.equal(post.bodyUsed, false);
  assert.equal(accesses, 0);
});

test('missing/broken binding, absent key and read failure give fixed uncached 503', async t => {
  offline(t);
  for (const env of [undefined, {}, { get PRICING_KV() { throw new Error('private storage detail'); } },
    { PRICING_KV: {} }, { PRICING_KV: { getWithMetadata() { throw new Error('private read detail'); } } },
    { PRICING_KV: { async getWithMetadata() { return { value: null, metadata: null }; } } }]) {
    await unavailable(await request(env));
  }
});

test('metadata is exact, bounded, typed and tied to original bytes/producer/evidence', async t => {
  offline(t);
  const mutations = [
    () => null,
    m => { delete m.verifier_revision; },
    m => { m.extra = 'x'; },
    m => { m.schema_version = '1'; },
    m => { m.publication_run_attempt = '2'; },
    m => { m.publication_run_id = '01'; },
    m => { m.data_revision = 'C'.repeat(40); },
    m => { m.verifier_revision = 'd'.repeat(39); },
    m => { m.producer_revision = 'f'.repeat(40); },
    m => { m.evidence_sha256 = 'f'.repeat(64); },
    m => { m.payload_sha256 = 'f'.repeat(64); },
    m => { m.published_at = '2026-09-09T12:00:00Z'; },
    m => { m.published_at = new Date(NOW - 1).toISOString(); },
    m => { m.published_at = new Date(NOW + 60001).toISOString(); },
    m => { m.data_revision = 'x'.repeat(1025); },
  ];
  for (const mutate of mutations) {
    const fixture = publication();
    const replacement = mutate(fixture.metadata);
    if (replacement === null) fixture.metadata = null;
    const kv = storage(fixture);
    await unavailable(await request(kv.env));
    assert.equal(kv.calls.length, 1);
  }
  const fixture = publication();
  fixture.metadata.published_at = new Date(NOW + 60000).toISOString();
  await success(await request(storage(fixture).env), fixture); // inclusive future tolerance
});

test('strict UTF-8 and canonical JSON reject BOM, duplicates, truncation and extra bytes even with matching hashes', async t => {
  offline(t);
  const record = syntheticRecord();
  const text = new TextDecoder().decode(canonical(record));
  for (const bytes of [
    new Uint8Array([0xff]), encode(`\uFEFF${text}`), encode(text.slice(0, -1)),
    encode(`${text}\n`), encode(JSON.stringify(record)), encode('{'),
    encode(text.replace('"schema_version": 1,', '"schema_version": 1,\n  "schema_version": 1,')),
  ]) {
    await unavailable(await request(storage(publication(record, bytes)).env));
  }
});

test('complete shared contract rejects incompatible/malformed production fields, not just the version label', async t => {
  offline(t);
  // One focused example per substantive contract group; Inventory owns exhaustive
  // model/evidence tests. Each mutation has a matching payload hash here.
  const mutations = [
    r => { r.schema_version = 2; },
    r => { r.kind = 'other'; },
    r => { r.source.provenance = 'local-only'; },
    r => { r.source.capture.ref = 'refs/heads/fixture'; },
    r => { r.source.capture.event = 'push'; },
    r => { r.source.payment_url = 'https://untrusted.example.test'; },
    r => { r.calculation.calculation_version = 2; },
    r => { r.calculation.source_chunk_bytes = '4194304'; },
    r => { r.rates.batch_eth_per_leaf = 0.1; },
    r => { r.rates.single_ant_per_chunk = '0'; },
    r => { r.storage_reference.batch.gas_covered_txns = '0'; },
    r => { r.storage_reference.single.window.cutoff_unix++; },
    r => { r.gas_reference.single.recent_day_billed_units = '1'; },
    r => { r.gas_reference.batch.total_gas_eth = '999'; },
    r => { r.exchange_reference.samples.eth_usd.sample_count = 199; },
    r => { r.exchange_reference.expires_at++; },
    r => { r.examples[2].batch_summary.rebalanced_tail = 'false'; },
    r => { r.examples[0].total_usd = null; },
    r => { r.examples.reverse(); },
    r => { r.limits[4] = 'Local only'; },
    r => { r.source.extra = true; },
    r => { r.assumptions.pop(); },
  ];
  for (const mutate of mutations) {
    const record = syntheticRecord();
    mutate(record);
    await unavailable(await request(storage(publication(record)).env));
  }
});

test('reader validates summary structure but never recomputes or rewrites monetary rates/examples', async t => {
  offline(t);
  const record = syntheticRecord();
  record.rates.batch_ant_per_leaf = '2';
  record.examples[0].storage_ant = '123';
  // Deliberately inconsistent synthetic arithmetic: independent producer checking
  // owns recomputation. The API cannot certify evidence it does not have.
  const fixture = publication(record);
  await success(await request(storage(fixture).env), fixture);
});

test('source chronology, future limits, invalid clocks and future currency windows fail closed', async t => {
  offline(t);
  for (const mutate of [
    r => { r.source.provider_generated_at = new Date(NOW - 1).toISOString(); },
    r => { r.source.capture.captured_at = new Date(NOW + 1).toISOString(); },
    r => { r.source.metadata_generated_at = '2026-02-30T12:00:00.000Z'; },
    r => { r.generated_at = new Date(NOW + 60001).toISOString(); },
  ]) {
    const record = syntheticRecord();
    mutate(record);
    const fixture = publication(record);
    fixture.metadata.published_at = record.generated_at;
    await unavailable(await request(storage(fixture).env));
  }
  for (const now of [0, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, NOW - 60001]) {
    Date.now.mock.mockImplementation(() => now);
    await unavailable(await request(storage().env));
  }
  // Native timestamps within tolerance are not enough: reference cannot start in the future.
  const record = syntheticRecord();
  record.exchange_reference.window_end++;
  record.exchange_reference.window_start++;
  record.exchange_reference.expires_at++;
  for (const sample of Object.values(record.exchange_reference.samples)) {
    sample.first_sample_at++; sample.last_sample_at++;
  }
  Date.now.mock.mockImplementation(() => NOW - 60000);
  await unavailable(await request(storage(publication(record)).env));
});

test('native and reference expiry are inclusive and independently bound cache time', async t => {
  offline(t);
  const fixture = publication();
  for (const [now, ttl, reference] of [
    [REFERENCE_END - 60500, 60, 'valid'], [REFERENCE_END - 1500, 1, 'valid'],
    [REFERENCE_END - 1, 0, 'valid'], [REFERENCE_END, 0, 'valid'],
    [REFERENCE_END + 1, 60, 'expired'], [NATIVE_END - 500, 0, 'expired'], [NATIVE_END, 0, 'expired'],
  ]) {
    Date.now.mock.mockImplementation(() => now);
    await success(await request(storage(fixture).env), fixture, { ttl, reference });
  }
  Date.now.mock.mockImplementation(() => NATIVE_END + 1);
  await unavailable(await request(storage(fixture).env));
  Date.now.mock.mockImplementation(() => REFERENCE_END + 1);
  const malformed = syntheticRecord();
  malformed.exchange_reference.exchange.eth_usd = '0';
  await unavailable(await request(storage(publication(malformed)).env)); // expired still must be structurally valid
});

test('final clock check sees native/reference boundaries crossed during the read', async t => {
  offline(t);
  const fixture = publication();
  for (const [before, after, expired] of [[NATIVE_END, NATIVE_END + 1, true], [REFERENCE_END, REFERENCE_END + 1, false]]) {
    Date.now.mock.mockImplementation(() => before);
    const env = { PRICING_KV: { async getWithMetadata() {
      return { metadata: fixture.metadata, value: new ReadableStream({ start(controller) {
        controller.enqueue(fixture.bytes);
        Date.now.mock.mockImplementation(() => after);
        controller.close();
      } }) };
    } } };
    const result = await request(env);
    if (expired) await unavailable(result);
    else await success(result, fixture, { reference: 'expired' });
  }
});

test('bounded stream stops on excess, metadata failure or read error without awaiting cancellation', async t => {
  offline(t);
  const fixture = publication();
  for (const mode of ['oversize', 'metadata', 'read-error']) {
    let reads = 0, cancellations = 0;
    const stream = new ReadableStream({
      pull(controller) {
        reads++;
        if (mode === 'read-error') throw new Error('private stream detail');
        controller.enqueue(new Uint8Array(reads === 1 ? 65536 : 1));
      },
      cancel() { cancellations++; return new Promise(() => {}); },
    }, { highWaterMark: 0 });
    const env = { PRICING_KV: { async getWithMetadata() {
      return { value: stream, metadata: mode === 'metadata' ? null : fixture.metadata };
    } } };
    await unavailable(await request(env));
    assert.equal(reads, mode === 'oversize' ? 2 : mode === 'metadata' ? 0 : 1);
    assert.equal(cancellations, mode === 'read-error' ? 0 : 1);
  }
});

test('one 2000ms deadline covers KV plus stream, returns despite stalled cancellation, and cancels late results', async t => {
  offline(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = publication();
  for (const mode of ['late-kv', 'stalled-body']) {
    let resolveKV, cancelled = 0, reads = 0;
    const stream = new ReadableStream({
      pull() { reads++; return new Promise(() => {}); },
      cancel() { cancelled++; return new Promise(() => {}); },
    }, { highWaterMark: 0 });
    const env = { PRICING_KV: { getWithMetadata() { return new Promise(resolve => { resolveKV = resolve; }); } } };
    let settled = false;
    const pending = request(env).then(result => { settled = true; return result; });
    t.mock.timers.tick(1500);
    if (mode === 'stalled-body') resolveKV({ value: stream, metadata: fixture.metadata });
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(499);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    await unavailable(await pending);
    if (mode === 'late-kv') resolveKV({ value: stream, metadata: fixture.metadata });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, 1);
    assert.equal(reads, mode === 'late-kv' ? 0 : 1);
  }
});

test('broken pricing cannot affect root, health, unknown routes or either supply cache/provider path', async t => {
  const h = await harness(t);
  const isolated = (await import('../worker/index.js?pricing-failure-isolation')).default;
  let bindingReads = 0;
  const env = { get PRICING_KV() { bindingReads++; throw new Error('private binding detail'); } };
  const call = path => isolated.fetch(new Request(`https://api.example.test${path}`), env);
  await unavailable(await call('/api/pricing'));
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.errors, []);
  await assertReply(await call('/api/total-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=3600' }, body: '1200000000',
  });
  await assertReply(await call('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  await assertJsonReply(await call('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  assert.equal(h.calls.length, 10);
  await unavailable(await call('/api/pricing'));
  await assertReply(await call('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  await assertJsonReply(await call('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  assert.equal(h.calls.length, 10); // pricing did not disturb either warm cache
  assert.equal((await call('/')).status, 200);
  assert.equal((await call('/llms.txt')).status, 200);
  await assertJsonReply(await call('/api/health'), {
    headers: JSON_HEADERS, body: { status: 'healthy', service: 'ANT Supply API', timestamp: new Date(NOW).toISOString() },
  });
  await assertReply(await call('/other'), { status: 404, headers: TEXT_HEADERS, body: 'Not found' });
  assert.equal(bindingReads, 2);
  assert.equal(h.calls.length, 10);
});
