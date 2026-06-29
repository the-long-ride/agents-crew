import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { collectViolations, countPhysicalLines, limits } from './check-file-lengths.mjs';

const makeLines = (count) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'agents-crew-loc-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('uses the requested extension limits', () => {
  assert.deepEqual(limits, new Map([
    ['.ts', 400],
    ['.html', 500],
    ['.css', 600],
  ]));
});

test('counts physical lines without treating a trailing newline as an extra line', () => {
  assert.equal(countPhysicalLines(''), 0);
  assert.equal(countPhysicalLines('one'), 1);
  assert.equal(countPhysicalLines('one\ntwo\n'), 2);
  assert.equal(countPhysicalLines('one\r\ntwo\r\n'), 2);
});

test('allows files exactly at their limit and reports files above it', () => {
  withFixture((root) => {
    writeFileSync(join(root, 'allowed.ts'), makeLines(400));
    writeFileSync(join(root, 'large.ts'), makeLines(401));
    writeFileSync(join(root, 'large.html'), makeLines(501));
    writeFileSync(join(root, 'large.css'), makeLines(601));

    assert.deepEqual(collectViolations(root), [
      { path: 'large.css', lines: 601, limit: 600 },
      { path: 'large.html', lines: 501, limit: 500 },
      { path: 'large.ts', lines: 401, limit: 400 },
    ]);
  });
});

test('ignores generated and dependency directories', () => {
  withFixture((root) => {
    for (const directory of [
      'node_modules',
      'target',
      'dist',
      '.git',
      '.worktrees',
      '.agents-crew',
      'coverage',
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(join(root, directory, 'large.ts'), makeLines(401));
    }
    assert.deepEqual(collectViolations(root), []);
  });
});
