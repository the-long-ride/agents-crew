import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('package exposes compiled TypeScript API and CLI bins', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(pkg.private, false);
  assert.equal(pkg.type, 'commonjs');
  assert.equal(pkg.main, './dist/index.js');
  assert.equal(pkg.types, './dist/index.d.ts');
  assert.equal(pkg.bin['agents-crew'], './dist/cli.js');
  assert.equal(pkg.bin['agent-bridge'], './dist/cli.js');
  assert.equal(pkg.scripts.build, 'tsc -p tsconfig.json');
  assert.ok(pkg.scripts.test.includes('node --test'));
});
