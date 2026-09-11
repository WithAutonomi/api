import assert from 'node:assert/strict';
import test from 'node:test';
import { CIRCULATING, DETAILED, JSON_HEADERS, ORIGIN, RPCS, SUPPLY_HEADERS,
  TEXT_HEADERS, TIME, ZERO_BALANCES } from './fixtures.mjs';
import { assertJsonReply, assertReply, harness } from './helpers.mjs';

test('GET total supply is the exact bare integer, without quotes or newline', async t => {
  const h = await harness(t);
  await assertReply(await h.request('/api/total-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=3600' }, body: '1200000000',
  });
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.cache.puts, []);
});

test('GET circulating supply subtracts all five raw balances before truncation', async t => {
  const h = await harness(t);
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(h.calls.map(call => call.url), Array(5).fill(RPCS[0]));
});

test('GET detailed supply preserves every wallet, purpose, decimal digit, type and timestamp', async t => {
  const h = await harness(t);
  await assertJsonReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 1, 2, 3, 4]);
});

for (const fixture of [
  { name: 'zero balances', balances: ZERO_BALANCES,
    circulating: '1200000000', excluded: '0', balance: '0', decimal: '0.000000000000000000' },
  { name: 'one wei (smallest unit)', balances: [1n, 0n, 0n, 0n, 0n],
    circulating: '1199999999', excluded: '0', balance: '0', decimal: '0.000000000000000001' },
  { name: 'exactly the whole supply', balances: [1200000000000000000000000000n, 0n, 0n, 0n, 0n],
    circulating: '0', excluded: '1200000000', balance: '1200000000', decimal: '1200000000.000000000000000000' },
  // Existing behavior, not validation policy: above-total balances are not
  // rejected/clamped and negative integer division truncates toward zero.
  { name: 'above-total balances', balances: [1200000001900000000000000000n, 0n, 0n, 0n, 0n],
    circulating: '-1', excluded: '1200000001', balance: '1200000001', decimal: '1200000001.900000000000000000' },
]) {
  test(`accounting boundary: ${fixture.name}`, async t => {
    const h = await harness(t);
    h.setBalances(fixture.balances);
    await assertReply(await h.request('/api/circulating-supply'), {
      headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: fixture.circulating,
    });
    await assertJsonReply(await h.request('/api/supply'), {
      headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' },
      body: {
        ...DETAILED, circulating_supply: fixture.circulating, total_excluded: fixture.excluded,
        excluded_wallets: DETAILED.excluded_wallets.map((wallet, index) => ({
          ...wallet, balance: index === 0 ? fixture.balance : '0',
          balance_with_decimals: index === 0 ? fixture.decimal : '0.000000000000000000',
        })),
      },
    });
    assert.equal(h.calls.length, 10);
  });
}

for (const path of ['/api/total-supply', '/api/circulating-supply', '/api/supply']) {
  const detailed = path === '/api/supply';
  const headers = detailed ? SUPPLY_HEADERS : TEXT_HEADERS;
  test(`${path}: OPTIONS preserves the existing preflight body and headers`, async t => {
    const h = await harness(t);
    await assertReply(await h.request(path, 'OPTIONS'), { headers, body: detailed ? 'null' : '' });
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.cache.matches, []);
    assert.deepEqual(h.cache.puts, []);
  });
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    test(`${path}: ${method} returns 405 without RPC or cache access`, async t => {
      const h = await harness(t);
      // Direct Worker response, before any HTTP server strips a HEAD body.
      await assertReply(await h.request(path, method), {
        status: 405, headers,
        body: detailed ? '{"error":"Method not allowed"}' : 'Method not allowed',
      });
      assert.equal(h.calls.length, 0);
      assert.deepEqual(h.cache.matches, []);
      assert.deepEqual(h.cache.puts, []);
    });
  }
}

for (const method of ['GET', 'OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`root: ${method} retains legacy index keys and links; additive discovery is allowed`, async t => {
    const h = await harness(t);
    const response = await h.request('/', method);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.fromEntries(response.headers), {
      ...JSON_HEADERS, 'cache-control': 'public, max-age=3600',
    });
    const data = await response.json();
    assert.equal(data.service, 'Autonomi API');
    assert.equal(data.source, 'https://github.com/WithAutonomi/api');
    assert.equal(typeof data.description, 'string');
    assert.ok(data.description.length > 0);
    assert.ok(Array.isArray(data.endpoints));
    // Do not deep-equal the whole index or freeze prose: the approved next
    // slice adds discovery descriptions/entries, keeping these existing links.
    for (const [name, type] of [
      ['health', 'application/json'], ['total-supply', 'text/plain'],
      ['circulating-supply', 'text/plain'], ['supply', 'application/json'],
    ]) {
      const endpoints = data.endpoints.filter(endpoint => endpoint.path === `/api/${name}`);
      assert.equal(endpoints.length, 1);
      assert.equal(endpoints[0].method, 'GET');
      assert.equal(endpoints[0].content_type, type);
      assert.equal(typeof endpoints[0].description, 'string');
      assert.ok(endpoints[0].description.length > 0);
      assert.equal(data._links[name], `${ORIGIN}/api/${name}`);
    }
    assert.equal(h.calls.length, 0);
  });

  test(`health: ${method} returns JSON without method restrictions or cache headers`, async t => {
    const h = await harness(t);
    await assertJsonReply(await h.request('/api/health', method), {
      headers: JSON_HEADERS, body: { status: 'healthy', service: 'ANT Supply API', timestamp: TIME },
    });
    h.advance(1);
    await assertJsonReply(await h.request('/api/health', method), {
      headers: JSON_HEADERS,
      body: { status: 'healthy', service: 'ANT Supply API', timestamp: '2026-09-09T12:00:00.001Z' },
    });
    assert.equal(h.calls.length, 0);
  });

  test(`unknown route: ${method} is 404, including OPTIONS and HEAD`, async t => {
    const h = await harness(t);
    await assertReply(await h.request('/not-an-endpoint', method), {
      status: 404, headers: TEXT_HEADERS, body: 'Not found',
    });
    assert.equal(h.calls.length, 0);
  });
}

test('trailing slashes and query strings normalize without redirecting', async t => {
  const h = await harness(t);
  // Absolute root URL avoids treating // as a network-path URL reference.
  const root = await h.request(`${ORIGIN}////?probe=1`);
  assert.equal(root.status, 200);
  assert.equal((await root.json()).service, 'Autonomi API');
  await assertJsonReply(await h.request('/api/health///?probe=1'), {
    headers: JSON_HEADERS, body: { status: 'healthy', service: 'ANT Supply API', timestamp: TIME },
  });
  await assertReply(await h.request('/api/total-supply///?probe=1'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=3600' }, body: '1200000000',
  });
  await assertReply(await h.request('/api/circulating-supply///?probe=1'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  await assertJsonReply(await h.request('/api/supply///?probe=1'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  for (const path of ['/missing///', '/api//health', '/API/health', '/api/health/extra']) {
    await assertReply(await h.request(path), { status: 404, headers: TEXT_HEADERS, body: 'Not found' });
  }
  assert.equal(h.calls.length, 10);
});
