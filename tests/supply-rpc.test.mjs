import assert from 'node:assert/strict';
import test from 'node:test';
import { CIRCULATING, DETAILED, RPCS, SUPPLY_HEADERS, SUPPLY_ROUTES, TEXT_HEADERS } from './fixtures.mjs';
import { allProviderError, assertJsonReply, assertReply, balanceReply,
  failingRPC, harness, rpcResult } from './helpers.mjs';

const failures = [
  { name: 'HTTP 429', reply: () => new Response('fixture rate limit', { status: 429 }) },
  { name: 'HTTP 503', reply: failingRPC },
  { name: 'JSON-RPC error', reply: () => Response.json({ error: { message: 'fixture RPC error' } }) },
  { name: 'error even with a result', reply: () => Response.json({ result: '0x0', error: { message: 'fixture RPC error' } }) },
  { name: 'missing result', reply: () => Response.json({ jsonrpc: '2.0', id: 1 }) },
  { name: 'numeric result', reply: () => rpcResult(123) },
  { name: 'null result', reply: () => rpcResult(null) },
  { name: 'object result', reply: () => rpcResult({ balance: '0x0' }) },
  { name: 'array result', reply: () => rpcResult(['0x0']) },
  { name: 'invalid JSON', reply: () => new Response('not JSON') },
  { name: 'null envelope', reply: () => Response.json(null) },
  { name: 'network rejection', reply: () => { throw new TypeError('Fixture network failure'); } },
  { name: 'body read rejection', reply: () => ({ ok: true, json: async () => { throw new Error('Fixture body read failure'); } }) },
  { name: 'timeout', reply: (h, call) => { h.expireTimeout(); call.options.signal.throwIfAborted(); } },
];

for (const route of SUPPLY_ROUTES) {
  for (const failure of failures) {
    test(`${route.path}: ${failure.name} falls back and prefers the successful provider`, async t => {
      const h = await harness(t);
      h.setFetch(call => call.url === RPCS[0] ? failure.reply(h, call) : balanceReply(call.walletIndex));
      await assertReply(await h.request(route.path), {
        headers: { ...route.headers, 'cache-control': 'public, max-age=60' }, body: route.body,
      });
      assert.deepEqual(h.calls.map(call => call.url), [RPCS[0], ...Array(5).fill(RPCS[1])]);
      assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 0, 1, 2, 3, 4]);
      assert.deepEqual(h.errors, [], 'Recovered provider errors are not public endpoint errors');
      h.advance(60000);
      const refreshed = route.key === 'supply'
        ? JSON.stringify({ ...DETAILED, timestamp: '2026-09-09T12:01:00.000Z' }) : route.body;
      await assertReply(await h.request(route.path), {
        headers: { ...route.headers, 'cache-control': 'public, max-age=60' }, body: refreshed,
      });
      assert.deepEqual(h.calls.slice(6).map(call => call.url), Array(5).fill(RPCS[1]));
    });
  }

  test(`${route.path}: all providers fail once each, then the exact cold error is returned`, async t => {
    const h = await harness(t);
    h.setFetch(failingRPC);
    const response = await h.request(route.path);
    if (route.key === 'circulating') {
      await assertReply(response, { status: 500, headers: route.headers, body: route.error });
    } else {
      await assertJsonReply(response, {
        status: 500, headers: route.headers, body: { error: route.error, details: allProviderError() },
      });
    }
    assert.deepEqual(h.calls.map(call => call.url), RPCS);
    assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 0, 0, 0, 0]);
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0][1].message, allProviderError());
    assert.deepEqual(h.cache.puts, []);
  });

  test(`${route.path}: total provider failure part-way through never publishes partial balances`, async t => {
    const h = await harness(t);
    h.setFetch(({ walletIndex }) => walletIndex === 2 ? failingRPC() : balanceReply(walletIndex));
    const response = await h.request(route.path);
    if (route.key === 'circulating') {
      await assertReply(response, { status: 500, headers: route.headers, body: route.error });
    } else {
      await assertJsonReply(response, {
        status: 500, headers: route.headers, body: { error: route.error, details: allProviderError() },
      });
    }
    assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 1, 2, 2, 2, 2, 2]);
    assert.deepEqual(h.calls.map(call => call.url), [RPCS[0], RPCS[0], ...RPCS]);
    assert.deepEqual(h.cache.puts, []);
  });

  for (const value of ['not-a-balance', '0x', '1.5']) {
    test(`${route.path}: invalid balance string ${JSON.stringify(value)} does NOT retry another provider`, async t => {
      const h = await harness(t);
      h.setFetch(() => rpcResult(value));
      const response = await h.request(route.path);
      if (route.key === 'circulating') {
        await assertReply(response, { status: 500, headers: route.headers, body: route.error });
      } else {
        await assertJsonReply(response, {
          status: 500, headers: route.headers,
          body: { error: route.error, details: `Cannot convert ${value} to a BigInt` },
        });
      }
      assert.deepEqual(h.calls.map(call => call.url), [RPCS[0]]);
      assert.deepEqual(h.cache.puts, []);
    });
  }
}

test('provider preference is shared between circulating and detailed handlers', async t => {
  const h = await harness(t);
  h.setFetch(call => call.url === RPCS[0] ? failingRPC() : balanceReply(call.walletIndex));
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  await assertJsonReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  assert.deepEqual(h.calls.map(call => call.url), [RPCS[0], ...Array(10).fill(RPCS[1])]);
});

test('provider search reaches the fifth endpoint, wraps around and updates preference', async t => {
  const h = await harness(t);
  h.setFetch(call => call.url === RPCS[4] ? balanceReply(call.walletIndex) : failingRPC());
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  assert.deepEqual(h.calls.map(call => call.url), [...RPCS, ...Array(4).fill(RPCS[4])]);
  h.advance(60000);
  h.setFetch(call => call.url === RPCS[0] ? balanceReply(call.walletIndex) : failingRPC());
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  assert.deepEqual(h.calls.slice(9).map(call => call.url), [RPCS[4], ...Array(5).fill(RPCS[0])]);
});

test('an isolate restart clears provider preference as well as warm module caches', async t => {
  const h = await harness(t);
  h.setFetch(call => call.url === RPCS[4] ? balanceReply(call.walletIndex) : failingRPC());
  await h.request('/api/circulating-supply');
  await h.restart();
  h.setFetch(null);
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  assert.deepEqual(h.calls.slice(9).map(call => call.url), Array(5).fill(RPCS[0]));
  assert.deepEqual(h.cache.matches, [], 'New isolate tries RPC even with an existing stale entry');
});

test('a later wallet can change the preferred provider without restarting earlier wallet queries', async t => {
  const h = await harness(t);
  h.setFetch(call => call.walletIndex === 2 && call.url === RPCS[0]
    ? failingRPC() : balanceReply(call.walletIndex));
  await assertJsonReply(await h.request('/api/supply'), {
    headers: { ...SUPPLY_HEADERS, 'cache-control': 'public, max-age=60' }, body: DETAILED,
  });
  assert.deepEqual(h.calls.map(call => call.walletIndex), [0, 1, 2, 2, 3, 4]);
  assert.deepEqual(h.calls.map(call => call.url), [RPCS[0], RPCS[0], RPCS[0], RPCS[1], RPCS[1], RPCS[1]]);
});

test('all-provider error details preserve rotated attempt order after a successful wallet', async t => {
  const h = await harness(t);
  h.setFetch(call => call.walletIndex === 0 && call.url === RPCS[3]
    ? balanceReply(call.walletIndex) : failingRPC());
  await assertJsonReply(await h.request('/api/supply'), {
    status: 500, headers: SUPPLY_HEADERS,
    body: { error: 'Failed to fetch supply details',
      details: allProviderError('HTTP 503', [RPCS[3], RPCS[4], RPCS[0], RPCS[1], RPCS[2]]) },
  });
  assert.deepEqual(h.calls.map(call => call.url), [
    RPCS[0], RPCS[1], RPCS[2], RPCS[3], RPCS[3], RPCS[4], RPCS[0], RPCS[1], RPCS[2],
  ]);
  assert.deepEqual(h.cache.puts, []);
});

test('detailed cold error retains each different provider failure in attempt order', async t => {
  const h = await harness(t);
  h.setFetch(call => {
    switch (call.url) {
      case RPCS[0]: return new Response('fixture rate limit', { status: 429 });
      case RPCS[1]: return Response.json({ error: { message: 'Fixture RPC error' } });
      case RPCS[2]: return Response.json({});
      case RPCS[3]: throw new TypeError('Fixture network failure');
      case RPCS[4]: h.expireTimeout(); call.options.signal.throwIfAborted();
    }
  });
  await assertJsonReply(await h.request('/api/supply'), {
    status: 500, headers: SUPPLY_HEADERS,
    body: {
      error: 'Failed to fetch supply details',
      details: 'RPC error: all endpoints failed (' +
        'https://arb1.arbitrum.io/rpc: HTTP 429; ' +
        'https://arbitrum-one-rpc.publicnode.com: Fixture RPC error; ' +
        'https://arbitrum.drpc.org: malformed result; ' +
        'https://arbitrum-one.public.blastapi.io: Fixture network failure; ' +
        'https://1rpc.io/arb: Fixture RPC timeout)',
    },
  });
  assert.deepEqual(h.calls.map(call => call.url), RPCS);
});

test('existing behavior: an invalid balance string still sets the next preferred RPC endpoint', async t => {
  const h = await harness(t);
  h.setFetch(call => call.url === RPCS[0] ? failingRPC() : rpcResult('invalid-balance'));
  await assertReply(await h.request('/api/circulating-supply'), {
    status: 500, headers: TEXT_HEADERS, body: 'Error calculating circulating supply',
  });
  assert.deepEqual(h.calls.map(call => call.url), [RPCS[0], RPCS[1]]);
  h.setFetch(null);
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: CIRCULATING,
  });
  assert.deepEqual(h.calls.slice(2).map(call => call.url), Array(5).fill(RPCS[1]));
});

for (const fixture of [
  { result: '', expected: '1200000000' },
  { result: ' ', expected: '1200000000' },
  { result: '1000000000000000000', expected: '1199999995' },
]) {
  test(`existing behavior: non-hex result ${JSON.stringify(fixture.result)} uses BigInt string conversion`, async t => {
    const h = await harness(t);
    h.setFetch(() => rpcResult(fixture.result));
    await assertReply(await h.request('/api/circulating-supply'), {
      headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: fixture.expected,
    });
    assert.equal(h.calls.length, 5);
  });
}

test('existing behavior: reply JSON-RPC version and ID are not validated', async t => {
  const h = await harness(t);
  h.setFetch(() => Response.json({ result: '0x0', jsonrpc: 'fixture-wrong-version', id: 999 }));
  await assertReply(await h.request('/api/circulating-supply'), {
    headers: { ...TEXT_HEADERS, 'cache-control': 'public, max-age=60' }, body: '1200000000',
  });
  assert.equal(h.calls.length, 5);
});
