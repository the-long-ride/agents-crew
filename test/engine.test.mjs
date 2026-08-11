import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { starterConfig } from '../dist/config/config.js';
import { createRun, createTask } from '../dist/domain/core.js';
import { advanceRun, persistRun, store } from '../dist/orchestration/engine.js';
import { RunProtocol } from '../dist/orchestration/protocol.js';

function makeRun(root, config, goal = 'engine test') {
  const run = createRun(goal, root, config.run.workspace_mode, config.manager, config.run.max_iterations);
  run.status = 'working';
  return run;
}

async function prepare(root, config, run) {
  await store(root).create(run);
  await new RunProtocol(root).materialize(run, config, {
    template_id: 'test', template_name: 'Test', goal: run.original_goal,
    expectations: [], acceptance_criteria: run.acceptance_criteria.map((item) => item.description), constraints: [],
  });
}

test('engine executes a CLI worker, verifies evidence, and runs final checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-engine-cli-'));
  const script = join(root, 'worker.mjs');
  await writeFile(script, `import { writeFile } from 'node:fs/promises';\nconst output = process.argv[2];\nawait writeFile(output, JSON.stringify({ task_id: 'inspect', status: 'completed', summary: 'done', artifacts: [], files_changed: [], commands_run: [], tests: [], evidence: [{ criterion_id: 'goal', source: 'worker', summary: 'verified', passed: true }], assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {}, capabilities_used: ['read'] }));\n`);
  const config = starterConfig();
  config.verification.require_independent_review = false;
  config.verification.commands = [[process.execPath, '-e', 'console.log("verified")']];
  config.workers = [{
    id: 'script-worker', kind: 'cli', enabled: true, adapter: 'custom', command: process.execPath,
    roles: ['researcher'], capabilities: ['read'], priority: 100, args: [script, '{output}'], env_allowlist: [], headers: {},
    requires_network: false, requires_credentials: false, model_fallback: 'allow_host_default',
  }];
  const run = makeRun(root, config);
  run.acceptance_criteria = [{ id: 'goal', description: 'inspection passes', required_checks: [] }];
  run.tasks.inspect = createTask('inspect', {
    title: 'Inspect', instructions: 'Inspect project', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'findings', max_attempts: 2,
  });
  await prepare(root, config, run);
  await advanceRun(root, config, run);
  await persistRun(root, run);

  assert.equal(run.status, 'completed');
  assert.equal(run.tasks.inspect.status, 'completed');
  assert.equal(run.tasks.inspect.assigned_worker, 'script-worker');
  assert.equal(run.verification.at(-1).status, 'passed');
  assert.match(run.verification.at(-1).summary, /verified/);
});

test('engine turns worker setup failures into bounded manager review actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-engine-failure-'));
  const config = starterConfig();
  config.verification.require_independent_review = false;
  const run = makeRun(root, config);
  run.tasks.write = createTask('write', {
    title: 'Write', instructions: 'Write project', role: 'implementer', capabilities: ['read', 'write'], write_scope: ['src'],
    dependencies: [], preferred_workers: [], expected_output: 'changes', max_attempts: 2,
  });
  await prepare(root, config, run);
  await advanceRun(root, config, run);

  assert.equal(run.status, 'manager_required');
  assert.equal(run.tasks.write.status, 'retryable');
  assert.equal(run.tasks.write.attempt, 1);
  assert.equal((await store(root).pendingActions(run.id))[0].action.type, 'review');
});

test('engine persists approval requests and terminal verification failures', async () => {
  const approvalRoot = await mkdtemp(join(tmpdir(), 'agents-crew-engine-approval-'));
  const approvalConfig = starterConfig();
  approvalConfig.verification.require_independent_review = false;
  approvalConfig.workers[0].capabilities.push('network');
  const approvalRun = makeRun(approvalRoot, approvalConfig);
  approvalRun.tasks.research = createTask('research', {
    title: 'Research', instructions: 'Use network', role: 'researcher', capabilities: ['read', 'network'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'research', max_attempts: 2,
  });
  await prepare(approvalRoot, approvalConfig, approvalRun);
  await advanceRun(approvalRoot, approvalConfig, approvalRun);
  assert.equal(approvalRun.status, 'awaiting_approval');
  assert.equal(approvalRun.approvals[0].operation, 'task:research:network');
  assert.equal((await store(approvalRoot).load(approvalRun.id)).status, 'awaiting_approval');

  const verifyRoot = await mkdtemp(join(tmpdir(), 'agents-crew-engine-verify-'));
  const verifyConfig = starterConfig();
  verifyConfig.verification.require_independent_review = false;
  verifyConfig.verification.commands = [[process.execPath, '-e', 'process.exit(3)']];
  const verifyRun = makeRun(verifyRoot, verifyConfig);
  await prepare(verifyRoot, verifyConfig, verifyRun);
  await advanceRun(verifyRoot, verifyConfig, verifyRun);
  assert.equal(verifyRun.status, 'failed');
  assert.equal(verifyRun.verification[0].status, 'failed');
  assert.match(verifyRun.terminal_summary, /verification/i);
  assert.equal((await store(verifyRoot).load(verifyRun.id)).status, 'failed');
  await access(join(verifyRoot, '.agents-crew', 'history', verifyRun.id, 'run.json'));
});

test('persistRun archives blocked and failed terminal runs into history', async () => {
  for (const status of ['failed', 'blocked']) {
    const root = await mkdtemp(join(tmpdir(), `agents-crew-engine-${status}-`));
    const config = starterConfig();
    const run = makeRun(root, config, `${status} run`);
    run.status = status;
    run.terminal_summary = `${status} for test`;
    await store(root).create(run);
    await persistRun(root, run);
    await access(join(root, '.agents-crew', 'history', run.id, 'run.json'));
    await assert.rejects(access(join(root, '.agents-crew', 'active', run.id, 'run.json')));
  }
});

test('engine observes an externally persisted pause before scheduling the next task', async () => {
  const { changeRunStatus } = await import('../dist/orchestration/run-control.js');
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-engine-external-pause-'));
  const script = join(root, 'pause-worker.mjs');
  await writeFile(script, `import { basename } from 'node:path'; import { writeFile } from 'node:fs/promises';\nconst output=process.argv[2]; const task=basename(output).startsWith('first-')?'first':'second'; await new Promise(r=>setTimeout(r,180)); await writeFile(output, JSON.stringify({task_id:task,status:'completed',summary:'done',artifacts:[],files_changed:[],commands_run:[],tests:[],evidence:[],assumptions:[],blockers:[],recommended_next_tasks:[],metadata:{},capabilities_used:['read']}));`);
  const config = starterConfig();
  config.verification.require_independent_review = false;
  config.workers = [{
    id: 'pause-worker', kind: 'cli', enabled: true, adapter: 'custom', command: process.execPath,
    roles: ['researcher'], capabilities: ['read'], priority: 100, args: [script, '{output}'], env_allowlist: [], headers: {},
    requires_network: false, requires_credentials: false, model_fallback: 'allow_host_default',
  }];
  const run = makeRun(root, config, 'pause boundary');
  run.tasks.first = createTask('first', {
    title: 'First', instructions: 'first', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'first', max_attempts: 2,
  });
  run.tasks.second = createTask('second', {
    title: 'Second', instructions: 'second', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: ['first'], preferred_workers: [], expected_output: 'second', max_attempts: 2,
  });
  await prepare(root, config, run);
  const advancing = advanceRun(root, config, run);
  let firstRunning = false;
  for (let attempt = 0; attempt < 50 && !firstRunning; attempt += 1) {
    const stored = await store(root).load(run.id);
    firstRunning = stored.tasks.first.status === 'running';
    if (!firstRunning) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(firstRunning, true);
  await changeRunStatus(root, run.id, 'paused', 'ui');
  await advancing;

  assert.equal(run.status, 'paused');
  assert.equal(run.tasks.first.status, 'completed');
  assert.equal(run.tasks.second.status, 'pending');
  assert.equal((await store(root).load(run.id)).status, 'paused');
});
