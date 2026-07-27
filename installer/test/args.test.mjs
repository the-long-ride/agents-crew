import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../dist/args.js';

test('parses a non-interactive manager install', () => {
  assert.deepEqual(parseArgs(['install', '--manager', 'claude-code', '--yes', '--repo', 'owner/repo', '--version', '1.2.3']), {
    command: 'install', manager: 'claude-code', yes: true, binaryOnly: false, repository: 'owner/repo', version: '1.2.3', workspace: process.cwd()
  });
});

test('rejects unknown manager hosts', () => {
  assert.throws(() => parseArgs(['install', '--manager', 'other']), /Unknown manager/);
});
