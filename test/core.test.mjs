import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRun,
  createTask,
  nextBatch,
  taskGraph,
  verifyCompletion,
  verifyTaskResult,
} from '../dist/domain/core.js';
import { decidePolicy } from '../dist/domain/policy.js';
import { starterConfig, validateConfig } from '../dist/config/config.js';

function draft(id, writes = false, dependencies = []) {
  return createTask(id, {
    title: id,
    instructions: `do ${id}`,
    role: writes ? 'implementer' : 'researcher',
    capabilities: writes ? ['read', 'write', 'shell'] : ['read'],
    write_scope: writes ? ['src'] : [],
    dependencies,
    preferred_workers: [],
    expected_output: 'evidence',
    max_attempts: 2,
  });
}

test('starter config is valid and keeps a native manager worker', () => {
  const config = starterConfig();
  assert.doesNotThrow(() => validateConfig(config));
  assert.equal(config.version, 1);
  assert.equal(config.workers[0].kind, 'native');
});

test('task graph rejects dependency cycles', () => {
  assert.throws(() => taskGraph([draft('a', false, ['b']), draft('b', false, ['a'])]), /cycle/i);
});

test('current workspace serializes writers while allowing readers', () => {
  const graph = taskGraph([draft('r1'), draft('r2'), draft('w1', true), draft('w2', true)]);
  const batch = nextBatch(graph, {
    workspace_mode: 'current',
    max_parallel_readers: 4,
    max_parallel_writers: 4,
    max_tasks_per_iteration: 8,
  });
  assert.deepEqual(batch.read_task_ids, ['r1', 'r2']);
  assert.deepEqual(batch.write_task_ids, ['w1']);
});

test('worker result cannot exceed task capabilities', () => {
  const task = draft('read');
  assert.throws(() => verifyTaskResult(task, {
    task_id: 'read', status: 'completed', summary: 'done', artifacts: [], files_changed: [],
    commands_run: [], capabilities_used: ['read', 'write'], tests: [], evidence: [], assumptions: [],
    blockers: [], recommended_next_tasks: [], metadata: {},
  }), /capabilities/i);
});

test('completion requires criterion evidence and permits cancelled tasks', () => {
  const run = createRun('goal', '.', 'current', {
    host: 'test', coding: 'never', small_fix_max_files: 0, small_fix_max_changed_lines: 0,
  }, 2);
  const old = draft('old');
  old.status = 'cancelled';
  run.tasks.old = old;
  run.acceptance_criteria.push({ id: 'goal', description: 'done', required_checks: [] });
  assert.throws(() => verifyCompletion(run), /evidence/i);
  run.evidence.push({ criterion_id: 'goal', source: 'reviewer', summary: 'verified', passed: true });
  assert.doesNotThrow(() => verifyCompletion(run));
});

test('small-fixes manager policy denies edits above limits', () => {
  const config = starterConfig();
  assert.equal(decidePolicy(config.permissions, { type: 'manager_write', files: 4, changed_lines: 20 }, {
    manager_coding: 'small_fixes', small_fix_max_files: 3, small_fix_max_changed_lines: 120,
  }), 'deny');
  assert.equal(decidePolicy(config.permissions, { type: 'push' }, {
    manager_coding: 'small_fixes', small_fix_max_files: 3, small_fix_max_changed_lines: 120,
  }), 'ask');
});

test('policy maps every guarded operation and manager coding mode', () => {
  const permissions = starterConfig().permissions;
  const context = { manager_coding: 'small_fixes', small_fix_max_files: 3, small_fix_max_changed_lines: 120 };
  for (const [type, expected] of [
    ['local_read', 'allow'], ['local_edit', 'allow'], ['test_command', 'allow'], ['network', 'ask'],
    ['destructive_command', 'ask'], ['credentialed_action', 'ask'], ['commit', 'ask'], ['push', 'ask'], ['deploy', 'ask'],
  ]) assert.equal(decidePolicy(permissions, { type }, context), expected);
  assert.equal(decidePolicy(permissions, { type: 'manager_write', files: 1, changed_lines: 1 }, { ...context, manager_coding: 'never' }), 'deny');
  assert.equal(decidePolicy(permissions, { type: 'manager_write', files: 99, changed_lines: 999 }, { ...context, manager_coding: 'full' }), 'allow');
  assert.equal(decidePolicy(permissions, { type: 'manager_write', files: 1, changed_lines: 1 }, context), 'allow');
});

test('task graph, result verification, and completion reject invalid states', () => {
  assert.throws(() => taskGraph([draft('same'), draft('same')]), /duplicate/);
  assert.throws(() => taskGraph([draft('unknown', false, ['missing'])]), /unknown dependency/);
  const dependent = draft('dependent', false, ['base']);
  const base = draft('base');
  const graph = taskGraph([base, dependent]);
  assert.deepEqual(nextBatch(graph, { workspace_mode: 'isolated', max_parallel_readers: 1, max_parallel_writers: 2, max_tasks_per_iteration: 1 }).read_task_ids, ['base']);
  base.status = 'completed';
  const ready = taskGraph([base, dependent]);
  assert.deepEqual(nextBatch(ready, { workspace_mode: 'isolated', max_parallel_readers: 1, max_parallel_writers: 2, max_tasks_per_iteration: 2 }).read_task_ids, ['dependent']);

  const read = draft('read');
  const result = { task_id: 'read', status: 'completed', summary: 'ok', artifacts: [], files_changed: [], commands_run: [], capabilities_used: ['read'], tests: [], evidence: [], assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {} };
  assert.throws(() => verifyTaskResult(read, { ...result, task_id: 'other' }), /task_id/);
  assert.throws(() => verifyTaskResult(read, { ...result, status: 'blocked', summary: 'blocked' }), /blocked/);
  assert.throws(() => verifyTaskResult(read, { ...result, tests: [{ command: ['x'], status: 'failed', summary: 'bad' }] }), /failed test/);

  const run = createRun('goal', '.', 'current', { host: 'x', coding: 'never', small_fix_max_files: 0, small_fix_max_changed_lines: 0 }, 1);
  run.acceptance_criteria = [];
  run.tasks.read = read;
  assert.throws(() => verifyCompletion(run), /not all active/);
  read.status = 'completed';
  run.verification.push({ command: ['x'], status: 'blocked', summary: 'no' });
  assert.throws(() => verifyCompletion(run), /verification/);
});

test('independent review distinguishes writer and reviewer workers', async () => {
  const { hasIndependentReview } = await import('../dist/domain/core.js');
  const run = createRun('goal', '.', 'current', { host: 'x', coding: 'full', small_fix_max_files: 1, small_fix_max_changed_lines: 1 }, 1);
  const writer = draft('write', true); writer.status = 'completed'; writer.assigned_worker = 'same';
  const reviewer = createTask('review', { title: 'review', instructions: 'review', role: 'reviewer', capabilities: ['read'], write_scope: [], dependencies: [], preferred_workers: [], expected_output: 'review', max_attempts: 1 });
  reviewer.status = 'completed'; reviewer.assigned_worker = 'same';
  run.tasks = { writer, reviewer };
  assert.equal(hasIndependentReview(run), false);
  reviewer.assigned_worker = 'other';
  assert.equal(hasIndependentReview(run), true);
});

test('task ids reject path traversal and unsafe filesystem characters', () => {
  const base = {
    title: 'bad', instructions: 'bad', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'none', max_attempts: 1,
  };
  for (const id of ['../escape', '..', '.', 'a/b', 'a\\b', '']) {
    assert.throws(() => createTask(id, base), /task id/i);
  }
  assert.equal(createTask('safe.task-1', base).id, 'safe.task-1');
});

test('task drafts validate runtime role, capabilities, scopes, and retry limits', () => {
  const valid = {
    title: 'task', instructions: 'work', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'result', max_attempts: 1,
  };
  for (const [mutate, expected] of [
    [draft => { draft.role = '../../secrets'; }, /role/i],
    [draft => { draft.capabilities = ['unknown']; }, /capability/i],
    [draft => { draft.write_scope = ['../outside']; }, /write scope/i],
    [draft => { draft.dependencies = ['../task']; }, /dependency/i],
    [draft => { draft.max_attempts = 0; }, /max_attempts/i],
    [draft => { draft.title = ''; }, /title/i],
  ]) {
    const draft = structuredClone(valid);
    mutate(draft);
    assert.throws(() => createTask('validated', draft), expected);
  }
});

test('worker result validation rejects malformed runtime JSON', () => {
  const task = draft('result-shape');
  assert.throws(() => verifyTaskResult(task, { task_id: 'result-shape', status: 'completed' }), /worker result/i);
  assert.throws(() => verifyTaskResult(task, {
    task_id: 'result-shape', status: 'completed', summary: 'done', artifacts: [], files_changed: [], commands_run: [],
    capabilities_used: ['bad'], tests: [], evidence: [], assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {},
  }), /capabilit/i);
});
