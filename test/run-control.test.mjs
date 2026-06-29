import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { starterConfig } from '../dist/config/config.js';
import { createRun, createTask } from '../dist/domain/core.js';
import { changeRunStatus, decideRunApproval, resumeRun } from '../dist/orchestration/run-control.js';
import { RunProtocol } from '../dist/orchestration/protocol.js';
import { RunStore } from '../dist/runtime/state.js';

function runAt(root, status = 'working') {
  const run = createRun('control test', root, 'current', {
    host: 'codex', coding: 'off', small_fix_max_files: 3, small_fix_max_changed_lines: 120,
  }, 4);
  run.status = status;
  return run;
}

test('run controls persist valid pause, resume, and cancel transitions with events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-control-'));
  const store = new RunStore(root);
  const run = runAt(root);
  run.tasks.inspect = createTask('inspect', {
    title: 'inspect', instructions: 'inspect', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'inspection', max_attempts: 2,
  });
  await store.create(run);
  await new RunProtocol(root).materialize(run, starterConfig(), { template_id: 'test', template_name: 'Test', goal: run.original_goal, expectations: [], acceptance_criteria: [], constraints: [] });

  assert.equal((await changeRunStatus(root, run.id, 'paused', 'test')).status, 'paused');
  assert.equal((await resumeRun(root, run.id)).status, 'manager_required');
  assert.equal((await changeRunStatus(root, run.id, 'cancelled', 'test')).status, 'cancelled');
  await assert.rejects(resumeRun(root, run.id), /terminal/);
  await assert.rejects(changeRunStatus(root, run.id, 'paused', 'test'), /terminal/);

  const kinds = (await store.readEvents(run.id)).map((event) => event.kind);
  assert.deepEqual(kinds, ['run_paused', 'run_resumed', 'task_started', 'manager_action_issued', 'run_cancelled']);
});

test('approval decisions transition blocked tasks and reject duplicate decisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-approval-control-'));
  const store = new RunStore(root);
  const run = runAt(root, 'awaiting_approval');
  run.tasks.work = createTask('work', {
    title: 'work', instructions: 'work', role: 'implementer', capabilities: ['read', 'write'], write_scope: ['src'],
    dependencies: [], preferred_workers: [], expected_output: 'work', max_attempts: 2,
  });
  run.tasks.work.status = 'blocked';
  run.approvals.push({ id: 'approval-1', operation: 'task:work:local_edit', reason: 'write', status: 'pending', created_at: new Date().toISOString() });
  await store.create(run);

  const approved = await decideRunApproval(root, run.id, 'approval-1', true);
  assert.equal(approved.status, 'working');
  assert.equal(approved.tasks.work.status, 'retryable');
  await assert.rejects(decideRunApproval(root, run.id, 'approval-1', false), /already decided/);

  const second = runAt(root, 'awaiting_approval');
  second.approvals.push({ id: 'approval-2', operation: 'run:test_command', reason: 'test', status: 'pending', created_at: new Date().toISOString() });
  await store.create(second);
  assert.equal((await decideRunApproval(root, second.id, 'approval-2', false)).status, 'blocked');
  await assert.rejects(resumeRun(root, second.id), /rejected approval/);
});
