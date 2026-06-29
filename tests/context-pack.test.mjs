import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextPack } from '../dist/index.js';

test('context pack includes task, workflow, participants, turns, changed files, and rules', () => {
  const markdown = buildContextPack({
    task: {
      taskId: 'task-1',
      goal: 'Ship adapters',
      workflow: 'implement-review',
      acceptanceCriteria: ['Adapters work'],
      changedFiles: ['src/index.ts'],
      participants: [{ id: 'codex-review', agent: 'codex', role: 'reviewer' }],
    },
    turns: [{ participantId: 'antigravity-impl', kind: 'implement', summary: 'Added code' }],
    instructions: ['Use RTK commands', 'Do not edit as reviewer'],
  });
  assert.match(markdown, /task-1/);
  assert.match(markdown, /implement-review/);
  assert.match(markdown, /src\/index\.ts/);
  assert.match(markdown, /Do not edit as reviewer/);
});

test('context pack includes test results when provided', () => {
  const markdown = buildContextPack({
    task: {
      taskId: 'task-2',
      goal: 'Test goal',
      workflow: 'pair-implement',
      acceptanceCriteria: ['A'],
      changedFiles: ['src/a.ts'],
      participants: [{ id: 'p1', agent: 'claude-code', role: 'implementer' }],
      tests: [{ command: 'npm test', status: 'passed', summary: 'All pass' }],
    },
    turns: [],
    instructions: [],
  });
  assert.match(markdown, /npm test/);
  assert.match(markdown, /All pass/);
});

test('context pack omits test results section when no tests', () => {
  const markdown = buildContextPack({
    task: {
      taskId: 'task-3',
      goal: 'Test goal',
      workflow: 'same-agent-loop',
      acceptanceCriteria: ['A'],
      changedFiles: ['src/b.ts'],
      participants: [{ id: 'p1', agent: 'opencode', role: 'implementer' }],
    },
    turns: [],
    instructions: [],
  });
  assert.doesNotMatch(markdown, /Test Results/);
});

test('context pack omits turns when empty', () => {
  const markdown = buildContextPack({
    task: {
      taskId: 'task-4',
      goal: 'Test goal',
      workflow: 'implement-review',
      acceptanceCriteria: ['A'],
      changedFiles: ['src/c.ts'],
      participants: [{ id: 'p1', agent: 'codex', role: 'reviewer' }],
    },
    turns: [],
    instructions: ['Be careful'],
  });
  assert.doesNotMatch(markdown, /Previous Turns/);
  assert.match(markdown, /Be careful/);
});

test('context pack omits instructions when empty', () => {
  const markdown = buildContextPack({
    task: {
      taskId: 'task-5',
      goal: 'Test goal',
      workflow: 'implement-review',
      acceptanceCriteria: ['A'],
      changedFiles: ['src/d.ts'],
      participants: [{ id: 'p1', agent: 'codex', role: 'reviewer' }],
    },
    turns: [],
    instructions: [],
  });
  assert.doesNotMatch(markdown, /Instructions/);
});
