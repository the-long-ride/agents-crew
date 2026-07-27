import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeArchiveEntries, extractArchive } from '../dist/archive.js';

test('accepts normal entries and rejects empty, absolute, drive, and traversal entries', () => {
  assert.doesNotThrow(() => assertSafeArchiveEntries(['crew', 'nested/agents-crew', 'LICENSE']));
  for (const entry of ['', '../crew', '/tmp/crew', 'C:\\temp\\crew.exe', 'nested/../crew']) {
    assert.throws(() => assertSafeArchiveEntries([entry]), /Unsafe archive entry/);
  }
});

test('lists, validates, and extracts zip archives through PowerShell', async () => {
  const calls = [];
  await extractArchive('release.ZIP', '/tmp/output', {
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: calls.length === 1 ? 'crew.exe\nagents-crew.exe\n' : '', stderr: '', code: 0 };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.equal(calls[0].options.env.AGENTS_CREW_ARCHIVE, 'release.ZIP');
  assert.equal(calls[1].options.env.AGENTS_CREW_DESTINATION, '/tmp/output');
});

test('lists and extracts tar archives and blocks unsafe listings', async () => {
  const calls = [];
  await extractArchive('release.tar.gz', '/tmp/output', {
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { stdout: calls.length === 1 ? 'crew\nagents-crew\n' : '', stderr: '', code: 0 };
    },
  });
  assert.deepEqual(calls, [
    ['tar', ['-tf', 'release.tar.gz']],
    ['tar', ['-xf', 'release.tar.gz', '-C', '/tmp/output']],
  ]);

  await assert.rejects(
    () => extractArchive('bad.tar.gz', '/tmp/output', {
      runCommand: async () => ({ stdout: '../crew\n', stderr: '', code: 0 }),
    }),
    /Unsafe archive entry/,
  );
});

test('extracts a real tar archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crew-archive-'));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  const archive = join(root, 'release.tar.gz');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(source));
  await writeFile(join(source, 'crew'), 'binary');
  const { runCommand } = await import('../dist/process.js');
  await runCommand('tar', ['-czf', archive, '-C', source, 'crew'], { quiet: true });
  await extractArchive(archive, destination);
  assert.equal(await readFile(join(destination, 'crew'), 'utf8'), 'binary');
});
