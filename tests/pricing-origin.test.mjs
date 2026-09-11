import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('vendored platform-neutral modules match reviewed Inventory origin hashes without sibling checkout', async () => {
  const root = new URL('../', import.meta.url);
  const origin = JSON.parse(await readFile(new URL('worker/pricing/origin.json', root), 'utf8'));
  assert.equal(origin.repository, 'https://github.com/WithAutonomi/inventory');
  assert.equal(origin.revision, '07fa880e2600bb5b2e2156f2b5ed87654f25e5f9');
  assert.deepEqual(origin.files.map(file => file.source), ['pricing/record-contract.mjs', 'pricing/model.mjs']);
  for (const file of origin.files) {
    assert.equal(file.vendored, `worker/${file.source}`);
    const bytes = await readFile(new URL(file.vendored, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.doesNotMatch(bytes.toString(), /node:|\bfetch\s*\(|\.\.\//);
  }
  // Keep the entire deployed import chain local and producer/fixture-free.
  for (const [path, imports] of [
    ['worker/index.js', ['./pricing.js']],
    ['worker/pricing.js', ['./pricing/record-contract.mjs']],
    ['worker/pricing/record-contract.mjs', ['./model.mjs']],
    ['worker/pricing/model.mjs', []],
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.deepEqual([...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]), imports);
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
  }
});
