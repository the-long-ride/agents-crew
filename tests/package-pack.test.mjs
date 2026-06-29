import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import test from 'node:test';

test('npm package dry-run includes dist, schemas, README, and package metadata', () => {
  const output = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8', windowsHide: true });
  const files = JSON.parse(output)[0].files.map(file => file.path);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.some(file => file.startsWith('dist/')));
  assert.ok(files.some(file => file.startsWith('schemas/')));
});
