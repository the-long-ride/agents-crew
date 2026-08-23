import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { starterConfig } from '../dist/config/config.js';
import { createRun, createTask } from '../dist/domain/core.js';
import { AgentMesh } from '../dist/orchestration/agent-mesh.js';
import { RunProtocol } from '../dist/orchestration/protocol.js';
import { RunStore } from '../dist/runtime/state.js';
import { agentCapabilities } from '../dist/cli/agent-command.js';

const exec = promisify(execFile);

function allowedConfig() {
  const config = structuredClone(starterConfig());
  for (const key of Object.keys(config.permissions)) config.permissions[key] = 'allow';
  config.run.workspace_mode = 'current';
  config.run.max_parallel_readers = 4;
  config.run.max_parallel_writers = 2;
  config.run.max_tasks_per_iteration = 4;
  return config;
}

function intent(goal) {
  return { template_id: 'test', template_name: 'Test', goal, expectations: [], acceptance_criteria: [], constraints: [] };
}

function result(taskId, capabilities = []) {
  return {
    task_id: taskId,
    status: 'completed',
    summary: 'done',
    artifacts: [],
    files_changed: [],
    commands_run: [],
    capabilities_used: capabilities,
    tests: [],
    evidence: [],
    assumptions: [],
    blockers: [],
    recommended_next_tasks: [],
    metadata: {},
  };
}

async function materializedRun(root, tasks, config = allowedConfig()) {
  const run = createRun('peer workflow', root, config.run.workspace_mode, {
    host: config.manager.host,
    coding: config.manager.coding,
    small_fix_max_files: config.manager.small_fix_max_files,
    small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
  }, config.run.max_iterations);
  run.tasks = Object.fromEntries(tasks.map((task) => [task.id, task]));
  run.status = 'working';
  const store = new RunStore(root);
  await store.create(run);
  await new RunProtocol(root).materialize(run, config, intent(run.original_goal));
  return { run, store, mesh: new AgentMesh(root), config };
}

test('peer workflow claims dependency-ready pending tasks and completes them without engine advancement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-peer-flow-'));
  const first = createTask('first', {
    title: 'first', instructions: 'inspect', role: 'researcher', capabilities: ['read'], write_scope: [], dependencies: [], preferred_workers: [], expected_output: 'notes', max_attempts: 2,
  });
  const second = createTask('second', {
    title: 'second', instructions: 'verify', role: 'tester', capabilities: ['read'], write_scope: [], dependencies: ['first'], preferred_workers: [], expected_output: 'verification', max_attempts: 2,
  });
  const { run, store, mesh } = await materializedRun(root, [first, second]);
  await mesh.register({ id: 'peer', roles: ['researcher', 'tester'], capabilities: ['read'], interfaces: [] });

  const firstLease = await mesh.claimTask(run.id, 'first', 'peer', 60);
  assert.equal(firstLease.task_id, 'first');
  await mesh.completeTask(run.id, 'first', 'peer', result('first', ['read']));

  const secondLease = await mesh.claimTask(run.id, 'second', 'peer', 60);
  assert.equal(secondLease.task_id, 'second');
  await mesh.completeTask(run.id, 'second', 'peer', result('second', ['read']));

  const saved = await store.load(run.id);
  assert.equal(saved.tasks.first.status, 'completed');
  assert.equal(saved.tasks.second.status, 'completed');
  await assert.rejects(() => mesh.releaseTask(run.id, 'second', 'peer'), /lease not found/i);
  assert.equal(agentCapabilities().operations.includes('complete'), true);
});

test('peer completion derives actual Git changes and enforces write scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-peer-git-'));
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Agents Crew Test'], { cwd: root });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'base.txt'), 'base\n');
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['commit', '-m', 'base'], { cwd: root });

  const task = createTask('write-task', {
    title: 'write', instructions: 'write', role: 'implementer', capabilities: ['read', 'write'], write_scope: ['src'], dependencies: [], preferred_workers: [], expected_output: 'code', max_attempts: 2,
  });
  const { run, store, mesh } = await materializedRun(root, [task]);
  await mesh.register({ id: 'writer', roles: ['implementer'], capabilities: ['read', 'write'], interfaces: [] });
  const lease = await mesh.claimTask(run.id, task.id, 'writer', 60);
  assert.equal(typeof lease.workspace_snapshot, 'object');
  await writeFile(join(root, 'src', 'new.txt'), 'new\n');

  await mesh.completeTask(run.id, task.id, 'writer', result(task.id, ['read', 'write']));
  const saved = await store.load(run.id);
  assert.deepEqual(saved.tasks[task.id].result.files_changed, ['src/new.txt']);
});

test('current-workspace peer claims serialize writers across different tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-peer-writers-'));
  const draft = (id) => createTask(id, {
    title: id, instructions: id, role: 'implementer', capabilities: ['write'], write_scope: ['.'], dependencies: [], preferred_workers: [], expected_output: 'code', max_attempts: 2,
  });
  const { run, mesh } = await materializedRun(root, [draft('a'), draft('b')]);
  await mesh.register({ id: 'a1', roles: ['implementer'], capabilities: ['write'], interfaces: [] });
  await mesh.register({ id: 'a2', roles: ['implementer'], capabilities: ['write'], interfaces: [] });
  await mesh.claimTask(run.id, 'a', 'a1', 60);
  await assert.rejects(() => mesh.claimTask(run.id, 'b', 'a2', 60), /writer|parallel/i);
  await mesh.releaseTask(run.id, 'a', 'a1');
  assert.equal((await mesh.claimTask(run.id, 'b', 'a2', 60)).agent_id, 'a2');
});
