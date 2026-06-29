import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(repositoryRoot, 'scripts', 'agent-bridge.cjs');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 10_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function git(workspace, ...args) {
  const result = run('git', args, { cwd: workspace });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-bridge-'));
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'agent-bridge@example.invalid');
  git(workspace, 'config', 'user.name', 'Agent Bridge Test');
  await writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  git(workspace, 'add', 'tracked.txt');
  git(workspace, 'commit', '--quiet', '-m', 'initial');
  return workspace;
}

function runBridge(workspace, ...args) {
  return run(process.execPath, [bridgePath, ...args, '--workspace', workspace], { cwd: workspace });
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function writeTaskDraft(workspace, overrides = {}) {
  const taskPath = path.join(workspace, 'task-input.json');
  await writeFile(
    taskPath,
    JSON.stringify({
      taskId: 'task-prepare',
      goal: 'Change tracked output',
      acceptanceCriteria: ['Tracked output is updated'],
      tests: [{ command: 'node --test', status: 'passed', summary: 'Tests passed' }],
      implementationSummary: 'Updated tracked output',
      antigravityConversationId: 'conversation-1',
      workflow: 'implement-review',
      participants: [{ id: 'antigravity-impl', agent: 'antigravity', role: 'implementer' }],
      ...overrides,
    }),
  );
  return taskPath;
}

test('disable and enable toggle workspace kill switch', async () => {
  const workspace = await createWorkspace();

  const disabled = parseJsonOutput(runBridge(workspace, 'disable', '--json'));
  assert.equal(disabled.enabled, false);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'DISABLED')), true);

  const enabled = parseJsonOutput(runBridge(workspace, 'enable', '--json'));
  assert.equal(enabled.enabled, true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'DISABLED')), false);
});

test('status reports ready task and cycle without mutating state', async () => {
  const workspace = await createWorkspace();
  const stateDirectory = path.join(workspace, '.agents-crew');
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  runBridge(workspace, 'disable', '--json');
  await writeFile(
    path.join(stateDirectory, 'TASK.json'),
    JSON.stringify({ taskId: 'task-123', reviewCycle: 2 }),
  );
  await writeFile(path.join(stateDirectory, 'READY.json'), JSON.stringify({ taskId: 'task-123' }));

  const status = parseJsonOutput(runBridge(workspace, 'status', '--json'));

  assert.deepEqual(
    {
      enabled: status.enabled,
      ready: status.ready,
      taskId: status.taskId,
      cycle: status.cycle,
    },
    { enabled: false, ready: true, taskId: 'task-123', cycle: 2 },
  );
  assert.equal(JSON.parse(await readFile(path.join(stateDirectory, 'TASK.json'), 'utf8')).reviewCycle, 2);
});

test('prepare seals changed files and deterministic Git snapshot identity', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  await writeFile(path.join(workspace, 'untracked.txt'), 'new\n');
  const taskPath = await writeTaskDraft(workspace);

  const prepared = parseJsonOutput(runBridge(workspace, 'prepare', '--task', taskPath, '--json'));
  const task = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'));
  const ready = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'READY.json'), 'utf8'));

  assert.equal(prepared.ready, true);
  assert.equal(task.schemaVersion, 1);
  assert.equal(task.repositoryRoot, workspace);
  assert.equal(task.baseCommit, git(workspace, 'rev-parse', 'HEAD'));
  assert.match(task.diffHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(task.changedFiles.sort(), ['task-input.json', 'tracked.txt', 'untracked.txt']);
  assert.equal(task.reviewCycle, 0);
  assert.equal(ready.taskId, task.taskId);
  assert.equal(ready.diffHash, task.diffHash);
});

test('prepare preserves review cycle for same task and resets it for new task', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  const firstDraft = await writeTaskDraft(workspace);
  parseJsonOutput(runBridge(workspace, 'prepare', '--task', firstDraft, '--json'));

  const storedPath = path.join(workspace, '.agents-crew', 'TASK.json');
  const stored = JSON.parse(await readFile(storedPath, 'utf8'));
  stored.reviewCycle = 2;
  await writeFile(storedPath, JSON.stringify(stored));
  parseJsonOutput(runBridge(workspace, 'prepare', '--task', firstDraft, '--json'));
  assert.equal(JSON.parse(await readFile(storedPath, 'utf8')).reviewCycle, 2);

  const secondDraft = await writeTaskDraft(workspace, { taskId: 'task-new' });
  parseJsonOutput(runBridge(workspace, 'prepare', '--task', secondDraft, '--json'));
  assert.equal(JSON.parse(await readFile(storedPath, 'utf8')).reviewCycle, 0);
});
