import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const requiredDocs = [
  'docs/workflows/implement-review.md',
  'docs/workflows/pair-implement.md',
  'docs/workflows/same-agent-loop.md',
  'docs/adapters/antigravity.md',
  'docs/adapters/codex.md',
  'docs/adapters/claude-code.md',
  'docs/adapters/opencode.md',
  'docs/adapters/github-copilot.md',
  'docs/plugins.md',
  'docs/tutorial.md'
];

for (const file of requiredDocs) {
  test(`${file} documents setup and failure handling`, async () => {
    const text = await readFile(file, 'utf8');
    assert.match(text, /setup/i);
    assert.match(text, /failure/i);
    assert.match(text, /example/i);
  });
}
