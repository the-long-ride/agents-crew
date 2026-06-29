import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

function cli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function cliWorkspace(workspace, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args, '--workspace', workspace], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
  });
}

function git(workspace, ...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-cli-'));
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'test@example.invalid');
  git(workspace, 'config', 'user.name', 'Test');
  await writeFile(path.join(workspace, '.gitignore'), '.agents-crew/\n');
  await writeFile(path.join(workspace, 'file.txt'), 'initial\n');
  git(workspace, 'add', '.gitignore', 'file.txt');
  git(workspace, 'commit', '--quiet', '-m', 'initial');
  return workspace;
}

async function writeTaskDraft(workspace, overrides = {}) {
  const taskPath = path.join(workspace, 'task-input.json');
  await writeFile(taskPath, JSON.stringify({
    taskId: 'task-cli',
    goal: 'Ship it',
    acceptanceCriteria: ['Works'],
    tests: [{ command: 'npm test', status: 'passed', summary: 'ok' }],
    implementationSummary: 'Done',
    workflow: 'implement-review',
    participants: [{ id: 'impl', agent: 'antigravity', role: 'implementer' }],
    ...overrides,
  }));
  return taskPath;
}

test('cli status prints JSON with --json', () => {
  const result = cli('status', '--json');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(typeof output.enabled, 'boolean');
  assert.equal(typeof output.ready, 'boolean');
});

test('cli status prints text without --json', () => {
  const result = cli('status');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agents-crew/);
});

test('cli rejects unknown command with clear error', () => {
  const result = cli('unknown');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown command/);
});

test('cli init creates .agents-crew directory', async () => {
  const workspace = await createWorkspace();
  const result = cliWorkspace(workspace, 'init', '--json');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.initialized, true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew')), true);
});

test('cli disable and enable toggle', async () => {
  const workspace = await createWorkspace();
  const disableResult = cliWorkspace(workspace, 'disable', '--json');
  assert.equal(disableResult.status, 0, disableResult.stderr);
  assert.equal(JSON.parse(disableResult.stdout).enabled, false);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'DISABLED')), true);

  const enableResult = cliWorkspace(workspace, 'enable', '--json');
  assert.equal(enableResult.status, 0, enableResult.stderr);
  assert.equal(JSON.parse(enableResult.stdout).enabled, true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'DISABLED')), false);
});

test('cli prepare seals git snapshot', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'file.txt'), 'changed\n');
  const taskPath = await writeTaskDraft(workspace);
  const result = cliWorkspace(workspace, 'prepare', '--task', taskPath, '--json');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ready, true);
  assert.equal(output.taskId, 'task-cli');
  const task = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'));
  assert.match(task.diffHash, /^[a-f0-9]{64}$/);
});

test('cli prepare with --workflow flag overrides task', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'file.txt'), 'changed\n');
  const taskPath = await writeTaskDraft(workspace);
  const result = cliWorkspace(workspace, 'prepare', '--task', taskPath, '--workflow', 'pair-implement', '--json');
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'));
  assert.equal(task.workflow, 'pair-implement');
});

test('cli prepare rejects missing task file', async () => {
  const workspace = await createWorkspace();
  const result = cliWorkspace(workspace, 'prepare', '--json');
  assert.notEqual(result.status, 0);
});

test('cli prepare rejects invalid task draft', async () => {
  const workspace = await createWorkspace();
  const badTaskPath = path.join(workspace, 'bad-task.json');
  await writeFile(badTaskPath, JSON.stringify({ taskId: '' }));
  const result = cliWorkspace(workspace, 'prepare', '--task', badTaskPath, '--json');
  assert.notEqual(result.status, 0);
});

test('cli hook returns stop when no task ready', async () => {
  const workspace = await createWorkspace();
  const result = spawnSync(process.execPath, [cliPath, 'hook', '--json', '--workspace', workspace], {
    encoding: 'utf8',
    windowsHide: true,
    input: '{}',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, 'stop');
});

test('cli run persists turn and review state for reviewer participant', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'file.txt'), 'changed\n');
  const taskPath = await writeTaskDraft(workspace, {
    participants: [
      { id: 'impl', agent: 'antigravity', role: 'implementer' },
      { id: 'review', agent: 'process', role: 'reviewer', command: process.execPath, args: [path.join(workspace, 'reviewer.cjs')] },
    ],
  });
  await writeFile(path.join(workspace, 'reviewer.cjs'), `process.stdout.write(JSON.stringify({status:'pass',summary:'ok',findings:[]})+'\\n');`);
  cliWorkspace(workspace, 'prepare', '--task', taskPath, '--json');

  const result = cliWorkspace(workspace, 'run', '--participant', 'review', '--json');
  assert.equal(result.status, 0, result.stderr);

  const turnsPath = path.join(workspace, '.agents-crew', 'TURNS.jsonl');
  assert.equal(existsSync(turnsPath), true);
  const turns = (await readFile(turnsPath, 'utf8')).trim().split('\n').filter(Boolean);
  assert.equal(turns.length, 1);
  const turn = JSON.parse(turns[0]);
  assert.equal(turn.participantId, 'review');
  assert.equal(turn.kind, 'review');

  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'REVIEW.json')), true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'READY.json')), false);
});

test('cli run requires --participant', async () => {
  const workspace = await createWorkspace();
  const taskPath = await writeTaskDraft(workspace);
  await writeFile(path.join(workspace, 'file.txt'), 'changed\n');
  cliWorkspace(workspace, 'prepare', '--task', taskPath, '--json');
  const result = cliWorkspace(workspace, 'run', '--json');
  assert.notEqual(result.status, 0);
});

test('cli next with no task returns error', async () => {
  const workspace = await createWorkspace();
  const result = cliWorkspace(workspace, 'next', '--json');
  assert.notEqual(result.status, 0);
});

test('cli next with task but no turns returns first participant', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'file.txt'), 'changed\n');
  const taskPath = await writeTaskDraft(workspace);
  cliWorkspace(workspace, 'prepare', '--task', taskPath, '--json');
  const result = cliWorkspace(workspace, 'next', '--json');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.action, 'continue');
  assert.equal(output.nextParticipantId, 'impl');
});

test('cli migrate rejects unknown target', async () => {
  const workspace = await createWorkspace();
  const result = cliWorkspace(workspace, 'migrate', 'unknown-target', '--json');
  assert.notEqual(result.status, 0);
});

test('cli migrate agent-bridge-v1', async () => {
  const workspace = await createWorkspace();
  const legacyDir = path.join(workspace, '.agent-bridge');
  await mkdir(legacyDir, { recursive: true });
  await writeFile(path.join(legacyDir, 'TASK.json'), JSON.stringify({ taskId: 'old' }));
  const result = cliWorkspace(workspace, 'migrate', 'agent-bridge-v1', '--json');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.migrated, true);
});

test('cli hook returns stop when disabled', async () => {
  const workspace = await createWorkspace();
  cliWorkspace(workspace, 'disable', '--json');
  const result = spawnSync(process.execPath, [cliPath, 'hook', '--json', '--workspace', workspace], {
    encoding: 'utf8',
    windowsHide: true,
    input: '{}',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).decision, 'stop');
});

test('cli rejects unknown flags', () => {
  const result = cli('status', '--bogus');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument/);
});
