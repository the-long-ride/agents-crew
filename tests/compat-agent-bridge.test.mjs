import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('legacy agent-bridge launcher delegates to compiled CLI', () => {
  const result = spawnSync(process.execPath, ['scripts/agent-bridge.cjs', 'status', '--json'], {
    encoding: 'utf8',
    windowsHide: true
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(typeof JSON.parse(result.stdout).enabled, 'boolean');
});
