import assert from 'node:assert/strict';
import test from 'node:test';
import { DETAILED, SUPPLY_HEADERS, SUPPLY_ROUTES,
  TEXT_HEADERS, ZERO_BALANCES } from './fixtures.mjs';
import { allProviderError, assertJsonReply, assertReply, balanceReply,
  failingRPC, harness, rpcResult } from './helpers.mjs';

function zeroBody(route, timestamp) {
  if (route.key === 'circulating') return '1200000000';
  return JSON.stringify({
    ...DETAILED, circulating_supply: '1200000000', total_excluded: '0', timestamp,
    excluded_wallets: DETAILED.excluded_wallets.map(wallet => ({
      ...wallet, balance: '0', balance_with_decimals: '0.000000000000000000',
    })),
  });
}

async function assertColdError(response, route) {
  if (route.key === 'circulating') {
    await assertReply(response, { status: 500, headers: route.headers, body: route.error });
  } else {
    await assertJsonReply(response, {
      status: 500, headers: route.headers, body: { error: route.error, details: allProviderError() },
    });
  }
}

for (const route of SUPPLY_ROUTES) {
  const freshHeaders = { ...route.headers, 'cache-control': 'public, max-age=60' };
  const staleHeaders = { ...freshHeaders, 'x-stale': 'true' };

  test(`${route.path}: warm cache hits at 0/59999ms, refreshes exactly at 60000ms`, async t => {
    const h = await harness(t);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    h.setBalances(ZERO_BALANCES);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    h.advance(59999);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    assert.equal(h.calls.length, 5);
    assert.equal(h.cache.puts.length, 1);
    assert.deepEqual(h.cache.matches, []);
    h.advance(1);
    const refreshed = zeroBody(route, '2026-09-09T12:01:00.000Z');
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: refreshed });
    assert.equal(h.calls.length, 10);
    h.advance(59999);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: refreshed });
    assert.equal(h.calls.length, 10);
    h.advance(1);
    await assertReply(await h.request(route.path), {
      headers: freshHeaders, body: zeroBody(route, '2026-09-09T12:02:00.000Z'),
    });
    assert.equal(h.calls.length, 15);
  });

  test(`${route.path}: warm-cache age starts before provider work, not when it finishes`, async t => {
    const h = await harness(t);
    h.setFetch(({ walletIndex }) => {
      h.advance(1000);
      return balanceReply(walletIndex);
    });
    const body = route.key === 'supply'
      ? JSON.stringify({ ...DETAILED, timestamp: '2026-09-09T12:00:05.000Z' }) : route.body;
    await assertReply(await h.request(route.path), { headers: freshHeaders, body });
    h.setFetch(null);
    h.setBalances(ZERO_BALANCES);
    h.advance(54999);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body });
    assert.equal(h.calls.length, 5);
    h.advance(1);
    await assertReply(await h.request(route.path), {
      headers: freshHeaders, body: zeroBody(route, '2026-09-09T12:01:00.000Z'),
    });
    assert.equal(h.calls.length, 10);
  });

  test(`${route.path}: successful calculation writes exact last-good bytes with a seven-day cache TTL`, async t => {
    const h = await harness(t);
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    assert.equal(h.cache.puts.length, 1);
    const write = h.cache.puts[0];
    assert.equal(write.url, `https://stale-supply.internal/${route.key}`);
    assert.equal(write.method, 'GET');
    assert.equal(write.headers['cache-control'], 'max-age=604800');
    assert.equal(write.body, route.body);
    assert.deepEqual(h.cache.matches, []);
  });

  test(`${route.path}: last-good memory wins over Cache API even after eight days`, async t => {
    const h = await harness(t);
    await h.request(route.path);
    h.cache.seed(route.key, route.key === 'supply' ? '{"fixture":"different cache value"}' : '111');
    h.advance(8 * 24 * 60 * 60 * 1000);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    assert.equal(h.calls.length, 15, 'Stale reads retry RPC; they do not renew the warm cache');
    assert.equal(h.cache.puts.length, 1, 'Failures never rewrite last-good storage');
    assert.deepEqual(h.cache.matches, [], 'Memory fallback takes precedence');
    assert.equal(h.errors.length, 2);
    // Actual existing behavior: no module-memory stale-age limit. The detailed
    // timestamp remains the original observation, not the time of the failure.
  });

  test(`${route.path}: cache survives an isolate restart and is reread on every failed refresh`, async t => {
    const h = await harness(t);
    await h.request(route.path);
    h.advance(60000);
    await h.restart();
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    assert.equal(h.calls.length, 15);
    assert.equal(h.cache.puts.length, 1);
    assert.deepEqual(h.cache.matches, Array(2).fill({
      url: `https://stale-supply.internal/${route.key}`, method: 'GET',
    }));
  });

  test(`${route.path}: cold Cache API fallback is used only after all providers fail`, async t => {
    const h = await harness(t);
    h.cache.seed(route.key, route.body);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    assert.equal(h.calls.length, 5);
    assert.equal(h.cache.matches.length, 1);
    assert.equal(h.cache.puts.length, 0);
  });

  test(`${route.path}: successful RPC takes precedence over an existing stale entry`, async t => {
    const h = await harness(t);
    h.cache.seed(route.key, 'not valid cached supply');
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    assert.deepEqual(h.cache.matches, []);
    assert.equal(h.cache.puts[0].body, route.body);
  });

  test(`${route.path}: provider recovery replaces last-good data and removes X-Stale`, async t => {
    const h = await harness(t);
    await h.request(route.path);
    h.advance(60000);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    h.advance(1);
    h.setFetch(null);
    h.setBalances(ZERO_BALANCES);
    const refreshed = zeroBody(route, '2026-09-09T12:01:00.001Z');
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: refreshed });
    h.advance(60000);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: refreshed });
    assert.equal(h.calls.length, 20);
    assert.deepEqual(h.cache.puts.map(write => write.body), [route.body, refreshed]);
  });

  test(`${route.path}: partial refresh cannot replace the last complete accounting result`, async t => {
    const h = await harness(t);
    await h.request(route.path);
    h.advance(60000);
    h.setFetch(({ walletIndex }) => walletIndex === 2
      ? rpcResult('invalid-balance') : balanceReply(walletIndex, ZERO_BALANCES));
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    assert.equal(h.calls.length, 8, 'Invalid string conversion stops at the third wallet');
    assert.equal(h.cache.puts.length, 1);
    assert.deepEqual(h.cache.matches, []);
  });

  test(`${route.path}: cache miss gives the current cold 500 response`, async t => {
    const h = await harness(t);
    h.setFetch(failingRPC);
    await assertColdError(await h.request(route.path), route);
    assert.equal(h.calls.length, 5);
    assert.deepEqual(h.cache.matches, [{ url: `https://stale-supply.internal/${route.key}`, method: 'GET' }]);
    assert.deepEqual(h.cache.puts, []);
    assert.equal(h.errors.length, 1);
  });

  test(`${route.path}: a throwing Cache API read does not replace the original provider error`, async t => {
    const h = await harness(t);
    h.cache.matchError = new Error('Fixture cache read failure');
    h.setFetch(failingRPC);
    await assertColdError(await h.request(route.path), route);
    assert.equal(h.calls.length, 5);
    assert.equal(h.cache.matches.length, 1);
  });

  test(`${route.path}: failure reading a cached response body acts as a cache miss`, async t => {
    const h = await harness(t);
    const match = t.mock.method(h.cache, 'match', async () => ({
      text: async () => { throw new Error('Fixture cached body failure'); },
    }));
    h.setFetch(failingRPC);
    await assertColdError(await h.request(route.path), route);
    assert.equal(match.mock.callCount(), 1);
    assert.equal(h.calls.length, 5);
  });

  test(`${route.path}: failed Cache API writes do not break fresh or memory-stale responses`, async t => {
    const h = await harness(t);
    h.cache.putError = new Error('Fixture cache write failure');
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    h.advance(60000);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    assert.deepEqual(h.cache.matches, []);
    await h.restart();
    await assertColdError(await h.request(route.path), route);
    assert.equal(h.cache.matches.length, 1, 'Failed write leaves no persistent fallback');
  });

  test(`${route.path}: missing Cache API still allows memory fallback but not restart recovery`, async t => {
    const h = await harness(t, { cacheAvailable: false });
    await assertReply(await h.request(route.path), { headers: freshHeaders, body: route.body });
    h.advance(60000);
    h.setFetch(failingRPC);
    await assertReply(await h.request(route.path), { headers: staleHeaders, body: route.body });
    await h.restart();
    await assertColdError(await h.request(route.path), route);
    assert.equal(h.calls.length, 15);
  });

  test(`${route.path}: a fallback for the other supply route cannot mask a cold failure`, async t => {
    const h = await harness(t);
    const other = SUPPLY_ROUTES.find(candidate => candidate.key !== route.key);
    await h.request(other.path);
    h.setFetch(failingRPC);
    await assertColdError(await h.request(route.path), route);
    assert.equal(h.calls.length, 10);
    assert.equal(h.cache.matches[0].url, `https://stale-supply.internal/${route.key}`);
  });
}

test('circulating and detailed warm caches have independent refresh boundaries', async t => {
  const h = await harness(t);
  await h.request('/api/circulating-supply');
  h.advance(30000);
  await assertJsonReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' },
    body: { ...DETAILED, timestamp: '2026-09-09T12:00:30.000Z' },
  });
  assert.equal(h.calls.length, 10);
  h.advance(30000);
  h.setBalances(ZERO_BALANCES);
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: '1200000000',
  });
  await assertJsonReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' },
    body: { ...DETAILED, timestamp: '2026-09-09T12:00:30.000Z' },
  });
  assert.equal(h.calls.length, 15);
  h.advance(30000);
  await assertReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' },
    body: zeroBody(SUPPLY_ROUTES[1], '2026-09-09T12:01:30.000Z'),
  });
  assert.equal(h.calls.length, 20);
});

test('zero circulating string is a valid warm and last-good memory value', async t => {
  const h = await harness(t);
  h.setBalances([1200000000000000000000000000n, 0n, 0n, 0n, 0n]);
  const headers = { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' };
  await assertReply(await h.request('/api/circulating-supply'), { headers, body: '0' });
  h.advance(59999);
  h.setFetch(failingRPC);
  await assertReply(await h.request('/api/circulating-supply'), { headers, body: '0' });
  assert.equal(h.calls.length, 5);
  h.advance(1);
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...headers, 'x-stale': 'true' }, body: '0',
  });
  assert.equal(h.calls.length, 10);
});

for (const cached of ['', '0', 'not a numeric supply']) {
  test(`existing behavior: circulating cache text ${JSON.stringify(cached)} is served without validation`, async t => {
    const h = await harness(t);
    h.cache.seed('circulating', cached);
    h.setFetch(failingRPC);
    await assertReply(await h.request('/api/circulating-supply'), {
      headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60', 'x-stale': 'true' }, body: cached,
    });
    assert.equal(h.calls.length, 5);
  });
}

for (const cached of [{ fixture: 'not a supply schema' }, 'fixture string', [], 0, false]) {
  test(`existing behavior: detailed Cache API accepts non-null JSON ${JSON.stringify(cached)}`, async t => {
    const h = await harness(t);
    h.cache.seed('supply', JSON.stringify(cached));
    h.setFetch(failingRPC);
    await assertJsonReply(await h.request('/api/supply'), {
      headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60', 'x-stale': 'true' }, body: cached,
    });
  });
}

for (const cached of ['', 'not json']) {
  test(`existing behavior: malformed detailed cached JSON ${JSON.stringify(cached)} causes 500`, async t => {
    const h = await harness(t);
    h.cache.seed('supply', cached);
    h.setFetch(failingRPC);
    const response = await h.request('/api/supply');
    assert.equal(response.status, 500);
    assert.deepEqual(Object.fromEntries(response.headers), SUPPLY_HEADERS);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['details', 'error']);
    assert.equal(body.error, 'Failed to fetch supply details');
    assert.equal(typeof body.details, 'string');
    assert.match(body.details, /JSON/);
    assert.ok(h.errors[0][1] instanceof SyntaxError);
    assert.equal(h.calls.length, 5);
  });
}

test('existing behavior: detailed cached JSON null is no fallback, not a stale 200', async t => {
  const h = await harness(t);
  h.cache.seed('supply', 'null');
  h.setFetch(failingRPC);
  await assertColdError(await h.request('/api/supply'), SUPPLY_ROUTES[1]);
});
