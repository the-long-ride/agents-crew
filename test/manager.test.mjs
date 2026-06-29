import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { saveConfig, starterConfig } from '../dist/config/config.js';
import { applyManagerDecision, managerStart, managerStep, submitManagerResult } from '../dist/orchestration/manager.js';

async function writeJson(root, name, value) {
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

test('manager protocol plans, dispatches native work, and completes from durable actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-manager-'));
  await saveConfig(join(root, '.agents-crew', 'config.toml'), starterConfig());
  const started = await managerStart(root, 'inspect the project', 'claude-code');
  assert.equal(started.actions[0].action.type, 'plan');
  const runId = started.run_id;
  const plan = await writeJson(root, 'plan.json', {
    acceptance_criteria: [{ id: 'goal', description: 'inspection complete', required_checks: [] }],
    tasks_to_add: [{
      id: 'inspect', title: 'Inspect project', instructions: 'Inspect files', role: 'researcher', capabilities: ['read'],
      write_scope: [], dependencies: [], preferred_workers: [], expected_output: 'findings', max_attempts: 2,
    }],
    tasks_to_cancel: [], review_decisions: [], approval_requests: [], should_continue: true, completion_claim: null,
  });
  await submitManagerResult(root, runId, started.actions[0].id, plan);
  const stepped = await managerStep(root, runId);
  const native = stepped.pending_actions.find((action) => action.action.type === 'dispatch_native');
  assert.ok(native);
  const result = await writeJson(root, 'result.json', {
    task_id: 'inspect', status: 'completed', summary: 'done', artifacts: [], files_changed: [], commands_run: [],
    capabilities_used: ['read'], tests: [], evidence: [{ criterion_id: 'goal', source: 'inspect', summary: 'checked', passed: true }],
    assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {},
  });
  await submitManagerResult(root, runId, native.id, result);
  const completed = await managerStep(root, runId);
  assert.equal(completed.run.status, 'completed');
});


function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function startNativeTask(root, task) {
  await saveConfig(join(root, '.agents-crew', 'config.toml'), starterConfig());
  const started = await managerStart(root, 'native write', 'claude-code');
  const plan = await writeJson(root, `plan-${task.id.replaceAll('/', '-')}.json`, {
    acceptance_criteria: [{ id: 'goal', description: 'work complete', required_checks: [] }],
    tasks_to_add: [task], tasks_to_cancel: [], review_decisions: [], approval_requests: [], should_continue: true, completion_claim: null,
  });
  await submitManagerResult(root, started.run_id, started.actions[0].id, plan);
  const stepped = await managerStep(root, started.run_id);
  return { runId: started.run_id, action: stepped.pending_actions.find((item) => item.action.type === 'dispatch_native') };
}

test('native submission uses actual Git changes and preserves rejected action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-manager-scope-'));
  git(root, ['init']); git(root, ['config', 'user.email', 'crew@example.invalid']); git(root, ['config', 'user.name', 'Crew Test']);
  await writeFile(join(root, 'base.txt'), 'base\n'); git(root, ['add', '.']); git(root, ['commit', '-m', 'base']);
  const { runId, action } = await startNativeTask(root, {
    id: 'write-src', title: 'Write source', instructions: 'write source', role: 'implementer', capabilities: ['read', 'write'],
    write_scope: ['src'], dependencies: [], preferred_workers: [], expected_output: 'source', max_attempts: 2,
  });
  assert.ok(action);
  await writeFile(join(root, 'README.md'), 'outside\n');
  const resultPath = await writeJson(root, 'native-result.json', {
    task_id: 'write-src', status: 'completed', summary: 'done', artifacts: [], files_changed: [], commands_run: [],
    capabilities_used: ['read', 'write'], tests: [], evidence: [{ criterion_id: 'goal', source: 'worker', summary: 'done', passed: true }],
    assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {},
  });
  await assert.rejects(submitManagerResult(root, runId, action.id, resultPath), /outside write scope/i);
  assert.equal((await managerStep(root, runId)).pending_actions.some((item) => item.id === action.id), true);

  await rm(join(root, 'README.md'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'ok.ts'), 'export const ok = true;\n');
  await submitManagerResult(root, runId, action.id, resultPath);
  const completed = await managerStep(root, runId);
  assert.equal(completed.run.status, 'completed');
  assert.deepEqual(completed.run.tasks['write-src'].result.files_changed, ['src/ok.ts']);
});

test('invalid manager task id does not consume the planning action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-manager-task-id-'));
  await saveConfig(join(root, '.agents-crew', 'config.toml'), starterConfig());
  const started = await managerStart(root, 'bad plan', 'claude-code');
  const plan = await writeJson(root, 'bad-plan.json', {
    acceptance_criteria: [],
    tasks_to_add: [{ id: '../escape', title: 'bad', instructions: 'bad', role: 'researcher', capabilities: ['read'], write_scope: [], dependencies: [], preferred_workers: [], expected_output: 'bad', max_attempts: 1 }],
    tasks_to_cancel: [], review_decisions: [], approval_requests: [], should_continue: true, completion_claim: null,
  });
  await assert.rejects(submitManagerResult(root, started.run_id, started.actions[0].id, plan), /task id/i);
  const state = await managerStep(root, started.run_id);
  assert.equal(state.pending_actions.some((item) => item.id === started.actions[0].id), true);
});


test('manager decisions reject malformed runtime payloads', () => {
  const run = { acceptance_criteria: [], tasks: {}, approvals: [], evidence: [], verification: [], status: 'planning' };
  assert.throws(() => applyManagerDecision(run, { should_continue: 'yes' }), /should_continue/);
  assert.throws(() => applyManagerDecision(run, { should_continue: true, tasks_to_cancel: 'task' }), /tasks_to_cancel/);
  assert.throws(() => applyManagerDecision(run, { should_continue: true, approval_requests: [{ id: '', operation: '', reason: '' }] }), /approval request/);
});
