import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';
import { MANAGERS, parseArgs } from '../dist/args.js';

test('parses every installer option and normalizes paths and versions', () => {
  const parsed = parseArgs([
    'install', '--manager', 'claude-code', '--yes', '--binary-only',
    '--repo', 'owner/repo', '--version', 'v1.2.3',
    '--install-dir', './bin', '--workspace', './workspace',
  ]);
  assert.deepEqual(parsed, {
    command: 'install', manager: 'claude-code', yes: true, binaryOnly: true,
    repository: 'owner/repo', version: '1.2.3', installDir: resolve('./bin'),
    workspace: resolve('./workspace'),
  });
  assert.equal(isAbsolute(parsed.installDir), true);
});

test('defaults to install and supports all help forms', () => {
  assert.equal(parseArgs([]).command, 'install');
  for (const argv of [['help'], ['--help'], ['install', '-h']]) {
    assert.deepEqual(parseArgs(argv), {
      command: 'help', yes: false, binaryOnly: false, workspace: process.cwd(),
    });
  }
});

test('exposes every supported manager host', () => {
  assert.deepEqual([...MANAGERS], ['codex', 'claude-code', 'opencode', 'antigravity']);
});

test('rejects invalid commands, options, managers, and missing values', () => {
  assert.throws(() => parseArgs(['remove']), /Unknown command/);
  assert.throws(() => parseArgs(['install', '--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['install', '--manager', 'other']), /Unknown manager/);
  assert.throws(() => parseArgs(['install', '--repo']), /requires a value/);
  assert.throws(() => parseArgs(['install', '--repo', '--yes']), /requires a value/);
});
