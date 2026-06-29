import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repositoryRoot, 'dist', 'cli.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 15_000,
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
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-bridge-hook-'));
  git(workspace, 'init', '--quiet');
  git(workspace, 'config', 'user.email', 'agent-bridge@example.invalid');
  git(workspace, 'config', 'user.name', 'Agent Bridge Test');
  await writeFile(path.join(workspace, '.gitignore'), '.agents-crew/\n');
  await writeFile(path.join(workspace, 'tracked.txt'), 'initial\n');
  git(workspace, 'add', '.gitignore', 'tracked.txt');
  git(workspace, 'commit', '--quiet', '-m', 'initial');
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed\n');
  return workspace;
}

function runCli(workspace, args, options = {}) {
  return run(process.execPath, [cliPath, ...args, '--workspace', workspace], {
    cwd: workspace,
    input: options.input,
    env: options.env,
    timeout: options.timeout,
  });
}

function parseSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  const trimmed = result.stdout.trim();
  assert.equal(trimmed.split(/\r?\n/).length, 1, `stdout must contain one JSON line: ${trimmed}`);
  return JSON.parse(trimmed);
}

async function prepare(workspace, taskId = 'hook-task') {
  const taskPath = path.join(workspace, '.agents-crew-task.json');
  await writeFile(
    taskPath,
    JSON.stringify({
      taskId,
      goal: 'Review changed output',
      acceptanceCriteria: ['Changed output is correct'],
      tests: [{ command: 'node --test', status: 'passed', summary: 'passed' }],
      implementationSummary: 'Changed tracked output',
      conversationId: 'conversation-hook',
      workflow: 'implement-review',
      participants: [
        { id: 'antigravity-impl', agent: 'antigravity', role: 'implementer' },
        { id: 'codex-review', agent: 'process', role: 'reviewer', command: process.execPath, args: [path.join(workspace, '.agents-crew', 'fake-reviewer.cjs')] },
      ],
    }),
  );
  parseSuccess(runCli(workspace, ['prepare', '--task', taskPath, '--json']));
  return taskPath;
}

async function createFakeReviewer(workspace) {
  const fakePath = path.join(workspace, '.agents-crew', 'fake-reviewer.cjs');
  mkdirSync(path.dirname(fakePath), { recursive: true });
  await writeFile(
    fakePath,
    `const fs = require('node:fs');
const result = JSON.parse(process.env.FAKE_REVIEWER_RESULT || '{"status":"pass","summary":"No findings","findings":[]}');
process.stdout.write(JSON.stringify(result) + '\\n');
`,
  );
  return fakePath;
}

function hookInput(overrides = {}) {
  return JSON.stringify({
    executionNum: 1,
    terminationReason: 'model_stop',
    error: '',
    fullyIdle: true,
    conversationId: 'conversation-hook',
    workspacePaths: [],
    transcriptPath: 'unused',
    artifactDirectoryPath: 'unused',
    ...overrides,
  });
}

function runHook(workspace, fakeReviewerResult, input = hookInput(), extraEnv = {}) {
  return runCli(workspace, ['hook', '--adapter', 'antigravity', '--json'], {
    input,
    env: {
      FAKE_REVIEWER_RESULT: JSON.stringify(fakeReviewerResult),
      ...extraEnv,
    },
  });
}

test('hook bypasses review when no marker, disabled, non-idle, or abnormal stop', async () => {
  const workspace = await createWorkspace();
  const fakeReviewer = await createFakeReviewer(workspace);

  assert.equal(parseSuccess(runHook(workspace, {}, hookInput(), {})).decision, 'stop');

  await prepare(workspace);
  parseSuccess(runCli(workspace, ['disable', '--json']));
  assert.equal(parseSuccess(runHook(workspace, {})).decision, 'stop');
  parseSuccess(runCli(workspace, ['enable', '--json']));
  assert.equal(
    parseSuccess(runHook(workspace, {}, hookInput({ fullyIdle: false }))).decision,
    'stop',
  );
  assert.equal(
    parseSuccess(runHook(workspace, {}, hookInput({ terminationReason: 'error' }))).decision,
    'stop',
  );
});

test('hook runs reviewer and writes review state on pass', async () => {
  const workspace = await createWorkspace();
  await prepare(workspace);
  await createFakeReviewer(workspace);

  const response = parseSuccess(
    runHook(workspace, { status: 'pass', summary: 'No findings', findings: [] }),
  );

  assert.equal(response.decision, 'stop');
  assert.match(response.reason, /passed/i);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'REVIEW.json')), true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'READY.json')), false);

  const review = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'REVIEW.json'), 'utf8'));
  assert.equal(review.status, 'pass');
  assert.equal(review.cycle, 1);
});

test('hook writes review and continues on findings', async () => {
  const workspace = await createWorkspace();
  await prepare(workspace);
  await createFakeReviewer(workspace);

  const response = parseSuccess(
    runHook(workspace, {
      status: 'findings',
      summary: 'One issue found',
      findings: [{ severity: 'high', file: 'tracked.txt', line: 1, title: 'Wrong', evidence: 'bad', requiredFix: 'fix' }],
    }),
  );

  assert.equal(response.decision, 'continue');
  assert.match(response.reason, /findings/i);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'REVIEW.json')), true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'READY.json')), true);

  const review = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'REVIEW.json'), 'utf8'));
  assert.equal(review.status, 'findings');
  assert.equal(review.cycle, 1);

  const task = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'));
  assert.equal(task.reviewCycle, 1);
});

test('hook escalates after review limit', async () => {
  const workspace = await createWorkspace();
  await prepare(workspace);
  await createFakeReviewer(workspace);

  const findingsResult = {
    status: 'findings',
    summary: 'Issue',
    findings: [{ severity: 'high', file: 'f', line: 1, title: 't', evidence: 'e', requiredFix: 'f' }],
  };

  for (let i = 0; i < 3; i++) {
    parseSuccess(runHook(workspace, findingsResult));
    if (i < 2) {
      const taskPath = path.join(workspace, '.agents-crew-task.json');
      await writeFile(
        taskPath,
        JSON.stringify({
          taskId: 'hook-task',
          goal: 'Review changed output',
          acceptanceCriteria: ['Changed output is correct'],
          tests: [{ command: 'node --test', status: 'passed', summary: 'passed' }],
          implementationSummary: 'Changed tracked output',
          conversationId: 'conversation-hook',
          workflow: 'implement-review',
          participants: [
            { id: 'antigravity-impl', agent: 'antigravity', role: 'implementer' },
        { id: 'codex-review', agent: 'process', role: 'reviewer', command: process.execPath, args: [path.join(workspace, '.agents-crew', 'fake-reviewer.cjs')] },
          ],
        }),
      );
      parseSuccess(runCli(workspace, ['prepare', '--task', taskPath, '--json']));
    }
  }

  const task = JSON.parse(await readFile(path.join(workspace, '.agents-crew', 'TASK.json'), 'utf8'));
  assert.equal(task.reviewCycle, 3);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'NEEDS_HUMAN.md')), true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'READY.json')), false);
});

test('hook appends turn to TURNS.jsonl', async () => {
  const workspace = await createWorkspace();
  await prepare(workspace);
  await createFakeReviewer(workspace);

  parseSuccess(runHook(workspace, { status: 'pass', summary: 'Clean', findings: [] }));

  const turnsPath = path.join(workspace, '.agents-crew', 'TURNS.jsonl');
  assert.equal(existsSync(turnsPath), true);
  const turns = (await readFile(turnsPath, 'utf8')).trim().split('\n').filter(Boolean);
  assert.equal(turns.length, 1);
  const turn = JSON.parse(turns[0]);
  assert.equal(turn.kind, 'review');
  assert.equal(turn.participantId, 'codex-review');
});

test('hook writes NEEDS_HUMAN when diff changes', async () => {
  const workspace = await createWorkspace();
  await prepare(workspace);
  await createFakeReviewer(workspace);
  await writeFile(path.join(workspace, 'tracked.txt'), 'changed after prepare\n');

  const response = parseSuccess(
    runHook(workspace, { status: 'pass', summary: 'unused', findings: [] }),
  );

  assert.equal(response.decision, 'stop');
  assert.match(response.reason, /diff changed/i);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'NEEDS_HUMAN.md')), true);
});
