import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmInstall, selectManager } from '../dist/prompt.js';

function fakePrompt(answers) {
  const writes = [];
  let closed = false;
  return {
    writes,
    get closed() { return closed; },
    write(value) { writes.push(value); },
    async question() { return answers.shift() ?? ''; },
    close() { closed = true; },
  };
}

test('selects the default and explicit manager and always closes the prompt', async () => {
  const defaultPrompt = fakePrompt(['']);
  assert.equal(await selectManager(defaultPrompt), 'codex');
  assert.equal(defaultPrompt.closed, true);
  assert.match(defaultPrompt.writes.join(''), /claude-code/);

  const explicitPrompt = fakePrompt(['4']);
  assert.equal(await selectManager(explicitPrompt), 'antigravity');
  assert.equal(explicitPrompt.closed, true);
});

test('rejects invalid manager selections and closes the prompt', async () => {
  const prompt = fakePrompt(['x']);
  await assert.rejects(() => selectManager(prompt), /Invalid manager selection/);
  assert.equal(prompt.closed, true);
});

test('confirms default, yes, and no answers', async () => {
  for (const [answer, expected] of [['', true], ['Y', true], ['yes', true], ['n', false], ['later', false]]) {
    const prompt = fakePrompt([answer]);
    assert.equal(await confirmInstall('Summary', prompt), expected);
    assert.equal(prompt.closed, true);
    assert.match(prompt.writes.join(''), /Summary/);
  }
});
