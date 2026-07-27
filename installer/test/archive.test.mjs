import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeArchiveEntries } from '../dist/archive.js';

test('allows flat release files', () => {
  assert.doesNotThrow(() => assertSafeArchiveEntries(['crew', 'agents-crew', 'LICENSE']));
});

test('rejects absolute and traversal archive entries', () => {
  assert.throws(() => assertSafeArchiveEntries(['../crew']), /Unsafe archive entry/);
  assert.throws(() => assertSafeArchiveEntries(['/tmp/crew']), /Unsafe archive entry/);
  assert.throws(() => assertSafeArchiveEntries(['C:\\temp\\crew.exe']), /Unsafe archive entry/);
});
