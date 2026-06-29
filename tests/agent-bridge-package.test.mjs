import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repositoryRoot, 'packages', 'agent-bridge-core');
const packageCliPath = path.join(packageRoot, 'index.cjs');
const rootCliPath = path.join(repositoryRoot, 'scripts', 'agent-bridge.cjs');

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
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-bridge-package-'));
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'agent-bridge@example.invalid');
  git(workspace, 'config', 'user.name', 'Agent Bridge Test');
  await writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  git(workspace, 'add', 'tracked.txt');
  git(workspace, 'commit', '--quiet', '-m', 'initial');
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  return workspace;
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('package manifest exposes reusable core entrypoint', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(manifest.name, '@the-machine/agent-bridge-core');
  assert.equal(manifest.private, true);
  assert.equal(manifest.main, './index.cjs');
});

test('package CLI prepare accepts generic conversationId', async () => {
  const workspace = await createWorkspace();
  const taskPath = path.join(workspace, 'task-input.json');
  await writeFile(
    taskPath,
    JSON.stringify({
      taskId: 'generic-task',
      goal: 'Prepare a portable task',
      acceptanceCriteria: ['Task review state is created'],
      tests: [{ command: 'node --test', status: 'passed', summary: 'passed' }],
      implementationSummary: 'Prepared through package CLI',
      conversationId: 'conversation-generic',
      workflow: 'implement-review',
      participants: [{ id: 'antigravity-impl', agent: 'antigravity', role: 'implementer' }],
    }),
  );

  const result = run(
    process.execPath,
    [packageCliPath, 'prepare', '--task', taskPath, '--json', '--workspace', workspace],
    { cwd: workspace },
  );
  const status = parseJson(result);
  const storedTask = JSON.parse(
    await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'),
  );

  assert.equal(status.ready, true);
  assert.equal(storedTask.conversationId, 'conversation-generic');
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'READY.json')), true);
});

test('root CLI is thin wrapper over package core', async () => {
  const rootCli = await readFile(rootCliPath, 'utf8');
  assert.match(rootCli, /dist.*cli\.js/);
  assert.doesNotMatch(rootCli, /function parseArguments/);
});

test('README documents package-backed bridge workflow', async () => {
  const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');

  assert.match(readme, /Setting Up a Bridge/);
  assert.match(readme, /agents-crew prepare/);
  assert.match(readme, /NEEDS_HUMAN\.md/);
  assert.match(readme, /READY\.json/);
});
