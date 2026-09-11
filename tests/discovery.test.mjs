import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { forbidNetwork } from './pricing-fixtures.mjs';
import { assertReply } from './helpers.mjs';

const worker = (await import('../worker/index.js')).default;
await new Promise(resolve => setImmediate(resolve));
const HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS',
  allow: 'GET, OPTIONS', 'x-content-type-options': 'nosniff',
};

function directory(t) {
  forbidNetwork(t);
  let accesses = 0;
  const env = { get PRICING_KV() { accesses++; throw new Error('Directory must not read pricing'); } };
  t.after(() => assert.equal(accesses, 0));
  return (path, method = 'GET') => worker.fetch(new Request(`https://api.example.test${path}`, { method }), env);
}

test('root and llms share ordered descriptions/verified destinations, with bounded output and no storage/provider access', async t => {
  const request = directory(t);
  const root = await request('/');
  const rootText = await root.text();
  const data = JSON.parse(rootText);
  const prose = await request('/llms.txt///?ignored=1');
  assert.equal(prose.status, 200);
  assert.deepEqual(Object.fromEntries(prose.headers), { ...HEADERS, 'cache-control': 'public, max-age=3600' });
  const text = await prose.text();
  assert.ok(Buffer.byteLength(rootText) <= 16384);
  assert.ok(Buffer.byteLength(text) <= 16384);
  assert.ok(text.endsWith('\n') && !text.includes('\r'));
  assert.ok(text.startsWith(`# ${data.service}\n`));
  assert.ok(text.includes(data.description));
  assert.ok(text.includes(data.overview));
  assert.match(data.overview, /Autonomi token supply and upload-cost estimates/);
  assert.doesNotMatch(data.overview, /dated upload-cost references/);
  assert.deepEqual(data.interfaces.map(({ id, access }) => [id, access]), [
    ['antd', 'local-daemon'], ['daemon-sdks', 'daemon-client'], ['antd-mcp', 'daemon-client'],
    ['ant', 'direct-network'], ['ant-core', 'direct-network'],
  ]);
  const spec = await readFile(new URL('../docs/specs/pricing-api.md', import.meta.url), 'utf8');
  let position = text.indexOf(data.overview);
  for (const endpoint of data.endpoints) {
    assert.deepEqual(Object.keys(endpoint), ['path', 'method', 'content_type', 'description']);
    if (endpoint.path === '/llms.txt') {
      assert.ok(!text.includes(`https://api.autonomi.com${endpoint.path}`));
      continue;
    }
    const line = `- [${endpoint.method} ${endpoint.path}](https://api.autonomi.com${endpoint.path}): ${endpoint.description}`;
    assert.ok(text.indexOf(line) > position);
    position = text.indexOf(line);
  }
  for (const entry of data.interfaces) {
    assert.deepEqual(Object.keys(entry), ['id', 'name', 'description', 'access', 'documentation']);
    assert.ok(text.indexOf(`### ${entry.name}`) > position);
    assert.ok(text.indexOf(entry.description) > position);
    position = text.indexOf(entry.description);
    for (const { label, url } of entry.documentation) {
      const line = `- [${label}](${url})`;
      assert.ok(text.indexOf(line) > position);
      position = text.indexOf(line);
      assert.ok(spec.includes(`](${url})`), `Destination absent from reviewed contract: ${url}`);
    }
  }
  for (const { label, url } of data.documentation) {
    const line = `- [${label}](${url})`;
    assert.ok(text.indexOf(line) > position);
    position = text.indexOf(line);
    assert.ok(spec.includes(`](${url})`));
  }
  assert.equal(data._links.pricing, 'https://api.example.test/api/pricing');
  assert.equal(data._links.llms, 'https://api.example.test/llms.txt');
  assert.deepEqual(data.endpoints.slice(4).map(({ path, method, content_type }) => [path, method, content_type]), [
    ['/api/pricing', 'GET', 'application/json'], ['/llms.txt', 'GET', 'text/plain'],
  ]);
  assert.equal(data.endpoints[4].description, 'Upload-cost estimates for adding data to Autonomi, including storage fees and network transaction costs. These are not live quotes or guaranteed prices. For a file-specific estimate, use the Autonomi CLI or another supported client tool.');
  assert.deepEqual(data.documentation.slice(-2), [
    { label: 'CLI file-specific cost estimates', url: 'https://docs.autonomi.com/developers/cli/command-reference' },
    { label: 'Local REST API cost estimates', url: 'https://docs.autonomi.com/developers/sdk/install/reference/rest-api.md' },
  ]);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Never use expired\s+reference exchange rates or USD examples as current USD prices/);
  assert.match(spec, /Expired reference remains \*\*in the unchanged body\*\*, including its dated examples; the header and documentation explicitly forbid treating them as current USD/);
  assert.doesNotMatch(text, /curl |npm install|pip install|cargo install|\$\d|single_ant_per_chunk|data_revision/);
});

test('new llms method rules do not alter root methods, headers or legacy discovery values', async t => {
  const request = directory(t);
  for (const method of ['OPTIONS', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    await assertReply(await request('/llms.txt', method), {
      status: method === 'OPTIONS' ? 204 : 405, headers: { ...HEADERS, 'cache-control': 'no-store' },
      body: ['OPTIONS', 'HEAD'].includes(method) ? '' : 'Method not allowed',
    });
    const root = await request('/', method);
    assert.equal(root.status, 200);
    assert.deepEqual(Object.fromEntries(root.headers), {
      'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    });
    const data = await root.json();
    assert.equal(data.service, 'Autonomi API');
    assert.equal(data.description, 'Token supply, storage-cost estimates, and information about the APIs and tools for accessing Autonomi.');
    assert.equal(data.source, 'https://github.com/WithAutonomi/api');
    assert.deepEqual(data.endpoints.slice(0, 4).map(endpoint => endpoint.description), [
      'Checks whether this API service is responding. It does not check the Autonomi network or the freshness of supply or pricing data.',
      'Total ANT supply as a bare integer string (CoinMarketCap/CoinGecko format)',
      'Circulating ANT supply as a bare integer string: total supply minus excluded-wallet balances, read live from Arbitrum (CoinMarketCap/CoinGecko format)',
      "Detailed supply breakdown including each excluded wallet's live balance",
    ]);
    for (const name of ['health', 'total-supply', 'circulating-supply', 'supply']) {
      assert.equal(data._links[name], `https://api.example.test/api/${name}`);
    }
  }
});
