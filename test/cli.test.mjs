import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = fileURLToPath(new URL('../dist/cli/entry.js', import.meta.url));

function run(root, args) {
  return spawnSync(process.execPath, [cli, '--workspace', root, '--json', ...args], { encoding: 'utf8' });
}


test('compiled CLI reads the root package version after source relocation', () => {
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.0.2');
});

test('CLI initializes, validates config, and exposes both aliases through package metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-cli-'));
  const initialized = run(root, ['init', '--non-interactive']);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).initialized, true);
  const validated = run(root, ['config', 'validate']);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).valid, true);
  const listed = run(root, ['plugin', 'list']);
  assert.deepEqual(JSON.parse(listed.stdout).hosts, ['codex', 'claude-code', 'opencode', 'antigravity']);
});

test('human CLI output is structured and redirected output contains no ANSI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-cli-human-'));
  const initialized = spawnSync(process.execPath, [cli, '--workspace', root, 'init', '--non-interactive'], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /^◆ Agents Crew · initialized/mu);
  assert.match(initialized.stdout, /✓ Configuration/u);
  assert.doesNotMatch(initialized.stdout, /\u001b\[/u);

  const jsonResult = run(root, ['config', 'validate']);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  assert.doesNotMatch(jsonResult.stdout, /\u001b\[/u);
  assert.deepEqual(JSON.parse(jsonResult.stdout), { valid: true });
});
