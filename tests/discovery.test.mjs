import assert from 'node:assert/strict';
import test from 'node:test';
import { baseSource, forbidIO, loadWorker, request, reply } from './helpers.mjs';

const worker = await loadWorker();
test('root and llms share descriptions and links, distinguishing hosted information from local tools', async t => {
  const env = forbidIO(t);
  const root = await worker.fetch(request('/'), env);
  const data = await root.json();
  const llms = await worker.fetch(request('/llms.txt///?ignored=1'), env);
  const text = await llms.text();
  assert.equal(llms.status, 200);
  assert.equal(llms.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(llms.headers.get('cache-control'), 'public, max-age=3600');
  for (const description of [data.description, data.overview]) assert.ok(text.includes(description));
  assert.match(data.overview, /not to upload or retrieve network data/);
  assert.deepEqual(data.interfaces.map(i => [i.id, i.access]), [
    ['antd', 'local-daemon'], ['daemon-sdks', 'daemon-client'], ['antd-mcp', 'daemon-client'],
    ['ant', 'direct-network'], ['ant-core', 'direct-network'],
  ]);
  assert.equal(data.endpoints.length, 6);
  for (const endpoint of data.endpoints.filter(e => e.path !== '/llms.txt')) {
    assert.ok(text.includes(`- [GET ${endpoint.path}](https://api.autonomi.com${endpoint.path}): ${endpoint.description}`));
  }
  for (const entry of data.interfaces) assert.ok(text.includes(entry.description));
  for (const { label, url } of [...data.documentation, ...data.interfaces.flatMap(i => i.documentation)]) {
    assert.ok(text.includes(`- [${label}](${url})`));
    assert.equal(new URL(url).protocol, 'https:');
  }
  assert.match(data.endpoints.find(e => e.path === '/api/pricing').description, /not live quotes or guaranteed prices/);
  assert.equal(data._links.pricing, 'https://api.example.test/api/pricing');
  assert.equal(data._links.llms, 'https://api.example.test/llms.txt');
  assert.doesNotMatch(text, /curl |npm install|single_ant_per_chunk|data_revision/);
  assert.ok(text.endsWith('\n') && Buffer.byteLength(text) < 16384);
});
test('new llms method rules leave base root method/header quirks and legacy links intact', async t => {
  const env = forbidIO(t);
  const baseline = await loadWorker(baseSource());
  for (const method of ['GET', 'OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const old = await reply(await baseline.fetch(request('/', method), env));
    const current = await reply(await worker.fetch(request('////?ignored=1', method), env));
    assert.equal(current.status, old.status);
    assert.deepEqual(current.headers, old.headers);
    const data = JSON.parse(current.body);
    for (const [key, value] of Object.entries(JSON.parse(old.body)._links)) assert.equal(data._links[key], value);
    const llms = await reply(await worker.fetch(request('/llms.txt', method), env));
    assert.equal(llms.status, method === 'GET' ? 200 : method === 'OPTIONS' ? 204 : 405);
    assert.equal(llms.headers.allow, 'GET, OPTIONS');
    assert.equal(llms.headers['access-control-allow-origin'], '*');
    if (method !== 'GET') {
      assert.equal(llms.headers['cache-control'], 'no-store');
      assert.equal(llms.body, ['HEAD', 'OPTIONS'].includes(method) ? '' : 'Method not allowed');
    }
  }
});
