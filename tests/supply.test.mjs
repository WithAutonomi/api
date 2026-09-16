import assert from 'node:assert/strict';
import test from 'node:test';
import { baseSource, loadWorker, source, request, reply } from './helpers.mjs';

const original = baseSource();
const RealDate = Date;
const RPCS = ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com',
  'https://arbitrum.drpc.org', 'https://arbitrum-one.public.blastapi.io', 'https://1rpc.io/arb'];
const wallets = ['0xda4f3af146f86850de8e0d6fae6eee051ad0aa44', '0x675d39cdcea31ba8313565b03d684a3bbe183a1a',
  '0x4f7b7fd0533d06d2abfad07eae57c9ce8e92b670', '0xd10a556e6a5111b5d4dd5ae06761d41f6ce1d499',
  '0x1617c551e1d63e693b0f6b42fe5352a79f2f9961'];

async function scenario(t, code, run) {
  let now = RealDate.parse('2026-09-14T00:00:00.000Z');
  const log = { replies: [], calls: [], cache: [], errors: [], timeouts: [] };
  const stored = new Map();
  const state = { mode: 'ok', badCache: false, balances: wallets.map((_, i) => BigInt(i + 1) * 10n ** 18n + 1n) };
  t.mock.method(globalThis, 'Date', class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
  });
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'error', (message, error) => log.errors.push([message, error.message]));
  t.mock.method(AbortSignal, 'timeout', ms => {
    log.timeouts.push(ms);
    const controller = new AbortController();
    if (state.mode === 'timeout') controller.abort(new DOMException('Fixture timeout', 'TimeoutError'));
    return controller.signal;
  });
  const oldCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: {
    async put(req, res) {
      const body = await res.text();
      log.cache.push(['put', req.url, Object.fromEntries(res.headers), body]);
      if (state.badCache) throw new Error('Fixture cache unavailable');
      stored.set(req.url, body);
    },
    async match(req) {
      log.cache.push(['match', req.url]);
      if (state.badCache) throw new Error('Fixture cache unavailable');
      return stored.has(req.url) ? new Response(stored.get(req.url)) : undefined;
    },
  } } });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    log.calls.push([url, options.method, options.headers, body]);
    assert.equal(body.method, 'eth_call');
    assert.equal(body.params[0].to, '0xa78d8321B20c4Ef90eCd72f2588AA985A4BDb684');
    assert.equal(body.params[1], 'latest');
    const index = wallets.indexOf('0x' + body.params[0].data.slice(-40));
    assert.ok(index >= 0);
    options.signal.throwIfAborted();
    if (state.mode === 'fail' || (state.mode === 'fallback' && url === RPCS[0])) return new Response('', { status: 429 });
    if (state.mode === 'rpc-error') return Response.json({ error: { message: 'Fixture RPC error' } });
    if (state.mode === 'malformed') return Response.json({ result: 123 });
    if (state.mode === 'network') throw new TypeError('Fixture transport error');
    if (state.mode === 'partial' && index === 2) return Response.json({ result: 'bad-balance' });
    return Response.json({ result: '0x' + state.balances[index].toString(16) });
  });
  let worker = await loadWorker(code);
  const env = { get PRICING_KV() { assert.fail('Supply must never touch pricing KV'); } };
  const h = {
    ...log, state,
    advance(ms) { now += ms; },
    async restart() { worker = await loadWorker(code); },
    async call(path, method = 'GET') {
      const result = await reply(await worker.fetch(request(path, method), env));
      log.replies.push(result);
      return result;
    },
  };
  try {
    await run(h);
    assert.ok(log.timeouts.every(ms => ms === 8000));
    return log;
  } finally {
    if (oldCaches) Object.defineProperty(globalThis, 'caches', oldCaches);
    else delete globalThis.caches;
  }
}
async function parity(t, run) {
  const baseline = await scenario(t, original, run);
  const current = await scenario(t, source, run);
  assert.deepEqual(current, baseline, 'Responses, RPC order/bodies, cache effects and errors must match the original worker');
}

test('supply constants, accounting, cache, RPC and health/handler source are byte-identical to base', () => {
  for (const [start, end] of [
    ['// Public Arbitrum', '// Machine-readable index of everything'],
    ['async function handleHealth()', 'export default'],
  ]) {
    const currentEnd = end.startsWith('// Machine') ? '// One description/link source' : end;
    assert.equal(source.slice(source.indexOf(start), source.indexOf(currentEnd)),
      original.slice(original.indexOf(start), original.indexOf(end)));
  }
});
test('baseline parity: supply, health, unknown routes, trailing slashes and every method quirk', async t => {
  await parity(t, async h => {
    for (const path of ['/api/total-supply', '/api/circulating-supply', '/api/supply', '/api/health', '/missing']) {
      for (const method of ['GET', 'OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        await h.call(path + '///?ignored=1', method);
      }
    }
    assert.equal(h.replies[0].body, '1200000000');
    assert.equal(h.replies[7].body, '1199999984'); // Subtract all raw balances before truncating.
    const detail = JSON.parse(h.replies[14].body);
    assert.equal(detail.total_excluded, '15');
    assert.equal(detail.excluded_wallets[0].balance_with_decimals, '1.000000000000000001');
    assert.equal(typeof detail.decimals, 'number');
    assert.equal(h.calls.length, 10);
    assert.deepEqual(h.calls.map(call => call[0]), Array(10).fill(RPCS[0]));
    assert.equal(h.replies[15].body, 'null'); // Legacy detailed OPTIONS body.
    assert.equal(h.replies[16].body, '{"error":"Method not allowed"}'); // Direct Worker HEAD quirk.
    assert.equal(JSON.parse(h.replies[21].body).service, 'ANT Supply API');
  });
});
for (const path of ['/api/circulating-supply', '/api/supply']) {
  test(`baseline parity: ${path} cache boundary, stale memory, restart fallback and recovery`, async t => {
    await parity(t, async h => {
      const first = await h.call(path);
      h.advance(59999); await h.call(path);
      assert.equal(h.calls.length, 5);
      h.advance(1); await h.call(path);
      assert.equal(h.calls.length, 10);
      const refreshed = h.replies.at(-1);
      h.advance(8 * 86400000); h.state.mode = 'fail';
      assert.equal((await h.call(path)).body, refreshed.body);
      assert.equal(h.replies.at(-1).headers['x-stale'], 'true');
      await h.restart();
      assert.equal((await h.call(path)).body, refreshed.body);
      assert.equal(h.cache.at(-1)[0], 'match');
      h.state.mode = 'ok'; h.state.balances.fill(0n);
      const recovered = await h.call(path);
      assert.equal(recovered.headers['x-stale'], undefined);
      assert.notEqual(recovered.body, first.body);
      assert.equal(h.cache[0][2]['cache-control'], 'max-age=604800');
    });
  });
  test(`baseline parity: ${path} partial refresh and unavailable Cache API preserve last good`, async t => {
    await parity(t, async h => {
      h.state.badCache = true;
      const first = await h.call(path);
      h.advance(60000); h.state.mode = 'partial';
      assert.equal((await h.call(path)).body, first.body);
      assert.equal(h.calls.length, 8);
      await h.restart(); h.state.mode = 'fail';
      assert.equal((await h.call(path)).status, 500);
    });
  });
}
test('baseline parity: fallback preference is shared across supply routes', async t => {
  await parity(t, async h => {
    h.state.mode = 'fallback';
    await h.call('/api/circulating-supply'); await h.call('/api/supply');
    assert.deepEqual(h.calls.map(call => call[0]), [RPCS[0], ...Array(10).fill(RPCS[1])]);
  });
});
for (const mode of ['fail', 'rpc-error', 'malformed', 'network', 'timeout']) {
  test(`baseline parity: cold ${mode} failure tries each RPC and retains exact error responses`, async t => {
    await parity(t, async h => {
      h.state.mode = mode;
      for (const path of ['/api/circulating-supply', '/api/supply']) assert.equal((await h.call(path)).status, 500);
      assert.deepEqual(h.calls.map(call => call[0]), [...RPCS, ...RPCS]);
      assert.equal(h.cache.filter(entry => entry[0] === 'put').length, 0);
    });
  });
}
