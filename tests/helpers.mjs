import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const BASE = 'b8c5fb557049d0163b99c29f23708ec02ced7255';
export const source = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
export function baseSource() {
  return execFileSync('git', ['show', `${BASE}:worker/index.js`], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
  });
}
let isolate = 0;
export async function loadWorker(code = source) {
  // Fresh module memory per scenario; no disk copies or runtime source rewrites.
  const linked = code.replace('"./pricing.mjs"', JSON.stringify(new URL('../worker/pricing.mjs', import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(linked).toString('base64')}#${isolate++}`)).default;
}
export const request = (path, method = 'GET') => new Request(`https://api.example.test${path}`, { method });
export async function reply(response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}
export function forbidIO(t) {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected provider request'); });
  let storage = 0;
  t.after(() => { assert.equal(fetch.mock.callCount(), 0); assert.equal(storage, 0); });
  return { get PRICING_KV() { storage++; throw new Error('Unexpected pricing storage access'); } };
}
