import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createStatePaths, getGitSnapshot, acquireWorkspaceLock } from '../dist/index.js';

function git(workspace, ...args) {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'agents-crew-git-'));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'agents-crew@example.invalid');
  git(root, 'config', 'user.name', 'Agents Crew Test');
  await writeFile(path.join(root, '.gitignore'), '.agents-crew/\n');
  await writeFile(path.join(root, 'file.txt'), 'initial\n');
  git(root, 'add', '.gitignore', 'file.txt');
  git(root, 'commit', '--quiet', '-m', 'initial');
  return root;
}

test('git snapshot seals tracked and untracked changes', async () => {
  const root = await workspace();
  await writeFile(path.join(root, 'file.txt'), 'changed\n');
  await writeFile(path.join(root, 'new.txt'), 'new\n');
  const snapshot = getGitSnapshot(root, '.agents-crew');
  assert.equal(snapshot.repositoryRoot, root);
  assert.match(snapshot.diffHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.changedFiles.sort(), ['file.txt', 'new.txt']);
});

test('git snapshot excludes runtime directory from untracked', async () => {
  const root = await workspace();
  await writeFile(path.join(root, 'new.txt'), 'new\n');
  await import('node:fs/promises').then(fs => fs.mkdir(path.join(root, '.agents-crew'), { recursive: true }));
  await writeFile(path.join(root, '.agents-crew', 'TASK.json'), '{}');
  const snapshot = getGitSnapshot(root, '.agents-crew');
  assert.ok(!snapshot.changedFiles.includes('.agents-crew/TASK.json'));
});

test('git snapshot sees no changes on clean repo', async () => {
  const root = await workspace();
  const snapshot = getGitSnapshot(root, '.agents-crew');
  assert.equal(snapshot.changedFiles.length, 0);
  assert.match(snapshot.diffHash, /^[a-f0-9]{64}$/);
});

test('git snapshot includes baseCommit', async () => {
  const root = await workspace();
  const snapshot = getGitSnapshot(root, '.agents-crew');
  assert.match(snapshot.baseCommit, /^[a-f0-9]{40}$/);
});

test('workspace lock rejects concurrent writer', async () => {
  const root = await workspace();
  const paths = createStatePaths(root);
  const first = acquireWorkspaceLock(paths.lock, 'task-1', 'agent-a');
  assert.throws(() => acquireWorkspaceLock(paths.lock, 'task-1', 'agent-b'), /already active/);
  first.release();
});

test('workspace lock stores lock data', async () => {
  const root = await workspace();
  const paths = createStatePaths(root);
  const lock = acquireWorkspaceLock(paths.lock, 'task-1', 'agent-a');
  const data = JSON.parse(await readFile(paths.lock, 'utf8'));
  assert.equal(data.taskId, 'task-1');
  assert.equal(data.participantId, 'agent-a');
  assert.equal(data.pid, process.pid);
  lock.release();
});

test('workspace lock allows new lock after release', async () => {
  const root = await workspace();
  const paths = createStatePaths(root);
  const first = acquireWorkspaceLock(paths.lock, 'task-1', 'agent-a');
  first.release();
  const second = acquireWorkspaceLock(paths.lock, 'task-1', 'agent-b');
  second.release();
});
