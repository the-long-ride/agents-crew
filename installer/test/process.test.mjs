import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { runCommand } from '../dist/process.js';

test('runs commands with cwd and environment and captures output', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.env.CREW_VALUE + ":" + process.cwd())'], {
    cwd: process.cwd(), env: { CREW_VALUE: 'ok' }, quiet: true,
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^ok:/);
  assert.equal(result.stderr, '');
});

test('streams output unless quiet and reports command failures', async () => {
  const stdout = mock.method(process.stdout, 'write', () => true);
  const stderr = mock.method(process.stderr, 'write', () => true);
  try {
    await runCommand(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("warn")']);
    assert.equal(stdout.mock.calls.some((call) => call.arguments[0] === 'out'), true);
    assert.equal(stderr.mock.calls.some((call) => call.arguments[0] === 'warn'), true);
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
  }
  await assert.rejects(
    () => runCommand(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(7)'], { quiet: true }),
    /exited 7: boom/,
  );
  await assert.rejects(() => runCommand('definitely-not-a-real-command', [], { quiet: true }), /ENOENT/);
});
