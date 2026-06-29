import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

function cli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 10_000,
    windowsHide: true,
  });
}

function git(workspace, ...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-setup-'));
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'test@example.invalid');
  git(workspace, 'config', 'user.name', 'Test');
  await writeFile(path.join(workspace, '.gitignore'), '.agents-crew/\n');
  await writeFile(path.join(workspace, 'file.txt'), 'initial\n');
  git(workspace, 'add', '.gitignore', 'file.txt');
  git(workspace, 'commit', '--quiet', '-m', 'initial');
  return workspace;
}

test('setup with flags creates task-input.json and init', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 'auth-001',
    '--goal', 'Add rate limiting',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.setup, true);
  assert.equal(output.workflow, 'implement-review');
  assert.ok(output.participants.includes('implementer: claude-code'));
  assert.ok(output.participants.includes('reviewer: codex'));

  assert.equal(existsSync(path.join(workspace, '.agents-crew')), true);
  const taskInput = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(taskInput.taskId, 'auth-001');
  assert.equal(taskInput.goal, 'Add rate limiting');
  assert.equal(taskInput.workflow, 'implement-review');
  assert.equal(taskInput.participants.length, 2);
  assert.equal(taskInput.participants[0].agent, 'claude-code');
  assert.equal(taskInput.participants[0].role, 'implementer');
  assert.equal(taskInput.participants[1].agent, 'codex');
  assert.equal(taskInput.participants[1].role, 'reviewer');
});

test('setup with pair-implement workflow omits verifier by default', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'pair-implement',
    '--implementer', 'claude-code',
    '--pair-agent', 'opencode',
    '--task-id', 'db-005',
    '--goal', 'Add nullable column',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.workflow, 'pair-implement');
  assert.equal(output.participants.length, 2);

  const taskInput = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(taskInput.participants.length, 2);
  assert.equal(taskInput.participants[0].role, 'implementer');
  assert.equal(taskInput.participants[1].role, 'pair');
});

test('setup with pair-implement includes verifier when provided', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'pair-implement',
    '--implementer', 'claude-code',
    '--pair-agent', 'opencode',
    '--verifier', 'github-copilot',
    '--task-id', 'db-005',
    '--goal', 'Add nullable column',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const taskInput = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(taskInput.participants.length, 3);
  assert.equal(taskInput.participants[2].role, 'verifier');
  assert.equal(taskInput.participants[2].agent, 'github-copilot');
});

test('setup rejects unknown workflow', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'invalid',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 'x',
    '--goal', 'y',
    '--json',
  ], { cwd: workspace });

  assert.notEqual(result.status, 0);
});

test('setup rejects unknown agent', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'invalid-agent',
    '--reviewer', 'codex',
    '--task-id', 'x',
    '--goal', 'y',
    '--json',
  ], { cwd: workspace });

  assert.notEqual(result.status, 0);
});

test('setup interactive prompts for missing values', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--json',
  ], {
    cwd: workspace,
    input: 'implement-review\ncodex\nclaude-code\ninteractive-task\nInteractive goal\n',
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.setup, true);
  assert.equal(output.workflow, 'implement-review');

  const taskInput = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(taskInput.taskId, 'interactive-task');
  assert.equal(taskInput.goal, 'Interactive goal');
});

test('setup next steps mentions prepare command', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 't1',
    '--goal', 'Do stuff',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.ok(output.nextSteps.some((s) => s.includes('prepare')));
});

test('setup refuses to overwrite existing task-input.json', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'task-input.json'), '{"existing":true}');

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 't1',
    '--goal', 'Do stuff',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 1);
  const existing = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(existing.existing, true);
});

test('setup --force overwrites existing task-input.json', async () => {
  const workspace = await createWorkspace();
  await writeFile(path.join(workspace, 'task-input.json'), '{"existing":true}');

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 't1',
    '--goal', 'Do stuff',
    '--force',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  const taskInput = JSON.parse(await readFile(path.join(workspace, 'task-input.json'), 'utf8'));
  assert.equal(taskInput.taskId, 't1');
  assert.equal(taskInput.existing, undefined);
});

test('setup --output writes to custom path', async () => {
  const workspace = await createWorkspace();

  const result = cli([
    'setup',
    '--workspace', workspace,
    '--workflow', 'implement-review',
    '--implementer', 'claude-code',
    '--reviewer', 'codex',
    '--task-id', 't1',
    '--goal', 'Do stuff',
    '--output', 'custom-task.json',
    '--json',
  ], { cwd: workspace });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(workspace, 'custom-task.json')), true);
  assert.equal(existsSync(path.join(workspace, 'task-input.json')), false);
  const taskInput = JSON.parse(await readFile(path.join(workspace, 'custom-task.json'), 'utf8'));
  assert.equal(taskInput.taskId, 't1');
});
