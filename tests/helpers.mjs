import assert from 'node:assert/strict';
import { BALANCES, CONTRACT, DETAILED, ORIGIN, RPCS, TIME } from './fixtures.mjs';

let isolate = 0;
async function freshWorker() {
  // Import the actual, unchanged entry point. A query gives each simulated
  // isolate new module memory without source rewriting or production flags.
  return (await import(`../worker/index.js?supply-test=${++isolate}`)).default;
}

export function rpcResult(result) {
  return Response.json({ jsonrpc: '2.0', id: 1, result });
}

export function balanceReply(walletIndex, balances = BALANCES) {
  return rpcResult(`0x${balances[walletIndex].toString(16)}`);
}

export function failingRPC() {
  return new Response('fixture unavailable', { status: 503 });
}

export function allProviderError(reason = 'HTTP 503', providers = RPCS) {
  return `RPC error: all endpoints failed (${providers.map(url => `${url}: ${reason}`).join('; ')})`;
}

export function cacheFixture() {
  const entries = new Map();
  return {
    puts: [],
    matches: [],
    putError: null,
    matchError: null,
    seed(key, body) {
      entries.set(`https://stale-supply.internal/${key}`, new Response(body));
    },
    async put(request, response) {
      this.puts.push({ url: request.url, method: request.method,
        headers: Object.fromEntries(response.headers), body: await response.clone().text() });
      if (this.putError) throw this.putError;
      entries.set(request.url, response.clone());
    },
    async match(request) {
      this.matches.push({ url: request.url, method: request.method });
      if (this.matchError) throw this.matchError;
      return entries.get(request.url)?.clone();
    },
  };
}

// Tests in each file run sequentially (node:test default); separate files have
// separate processes. Every replaced global is restored, including on failure.
export async function harness(t, { cache = cacheFixture(), cacheAvailable = true } = {}) {
  const RealDate = globalThis.Date;
  const descriptors = Object.fromEntries(['Date', 'caches'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let now = RealDate.parse(TIME);
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  if (cacheAvailable) globalThis.caches = { default: cache };
  else delete globalThis.caches;

  const calls = [];
  const errors = [];
  const violations = [];
  const timeouts = [];
  const controllers = [];
  let balances = BALANCES;
  let respond = null;
  t.mock.method(console, 'error', (...args) => errors.push(args));
  t.mock.method(AbortSignal, 'timeout', ms => {
    timeouts.push(ms);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    // Never delegate to real fetch. Unexpected RPC shape must fail the test
    // even if the Worker catches the assertion and serves a stale response.
    let walletIndex;
    let payload;
    try {
      assert.ok(RPCS.includes(url), `Unexpected fetch target: ${url}`);
      assert.equal(options.method, 'POST');
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
      assert.ok(options.signal instanceof AbortSignal);
      payload = JSON.parse(options.body);
      walletIndex = DETAILED.excluded_wallets.findIndex(wallet =>
        payload.params?.[0]?.data === `0x70a08231000000000000000000000000${wallet.address.slice(2).toLowerCase()}`);
      assert.notEqual(walletIndex, -1, 'Only the five published balanceOf calls are allowed');
      assert.deepEqual(payload, {
        jsonrpc: '2.0', method: 'eth_call',
        params: [{ to: CONTRACT,
          data: `0x70a08231000000000000000000000000${DETAILED.excluded_wallets[walletIndex].address.slice(2).toLowerCase()}` }, 'latest'],
        id: 1,
      });
    } catch (error) {
      violations.push(error.message);
      throw error;
    }
    const call = { url, options, payload, walletIndex };
    calls.push(call);
    return respond ? respond(call) : balanceReply(walletIndex, balances);
  });
  t.after(() => {
    assert.deepEqual(violations, [], 'Unexpected request hidden by Worker error handling');
    assert.deepEqual(timeouts, Array(calls.length).fill(8000), 'Each RPC attempt has an 8-second timeout');
  });
  let worker = await freshWorker();
  return {
    calls, errors, timeouts, cache,
    request(path, method = 'GET') {
      return worker.fetch(new Request(new URL(path, ORIGIN), { method }));
    },
    advance(ms) { now += ms; },
    setBalances(values) { balances = values; },
    setFetch(fn) { respond = fn; },
    expireTimeout() {
      controllers.at(-1).abort(new DOMException('Fixture RPC timeout', 'TimeoutError'));
    },
    async restart() { worker = await freshWorker(); },
  };
}

export async function assertReply(response, { status = 200, headers, body }) {
  assert.equal(response.status, status);
  assert.deepEqual(Object.fromEntries(response.headers), headers);
  assert.equal(await response.text(), body);
}

export async function assertJsonReply(response, { status = 200, headers, body }) {
  assert.equal(response.status, status);
  assert.deepEqual(Object.fromEntries(response.headers), headers);
  assert.deepEqual(await response.json(), body);
}
