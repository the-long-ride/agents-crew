import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalScopedPath, GitRepository } from '../dist/runtime/git.js';

function run(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
function readContent(path) { return readFile(path, 'utf8').then((t) => t.replace(/\r\n/g, '\n')); }

test('scoped paths reject parent escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-path-'));
  assert.throws(() => canonicalScopedPath(root, '../x'), /escape/i);
  assert.equal(canonicalScopedPath(root, 'src').startsWith(root), true);
});

test('git worktrees are created and cleaned for isolated tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-'));
  for (const args of [['init', '--quiet'], ['config', 'user.email', 'crew@example.invalid'], ['config', 'user.name', 'Crew Test']]) {
    assert.equal(spawnSync('git', args, { cwd: root }).status, 0);
  }
  await writeFile(join(root, 'README.md'), 'test');
  assert.equal(spawnSync('git', ['add', 'README.md'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root }).status, 0);
  const repository = await GitRepository.discover(root);
  const path = await repository.createTaskWorktree('run-one', 'task-a');
  assert.match(path, /task-a/);
  await repository.cleanupRunWorktrees('run-one');
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.doesNotMatch(listed, /task-a/);
});


test('isolated worktree changes integrate back into the main workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-integrate-'));
  await run(root, ['init']);
  await run(root, ['config', 'user.email', 'test@example.com']);
  await run(root, ['config', 'user.name', 'Test']);
  await writeFile(join(root, 'base.txt'), 'base\n');
  await run(root, ['add', '.']);
  await run(root, ['commit', '-m', 'base']);
  const repository = await GitRepository.discover(root);
  const worktree = await repository.createTaskWorktree('run-2', 'write');
  await writeFile(join(worktree, 'base.txt'), 'changed\n');
  await repository.integrateTaskWorktree(worktree);
  assert.equal(await readContent(join(root, 'base.txt')), 'changed\n');
  await repository.cleanupTaskWorktree(worktree);
});

test('git scope and status helpers validate allowed and rejected changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-scope-'));
  run(root, ['init']); run(root, ['config', 'user.email', 'x@example.com']); run(root, ['config', 'user.name', 'X']);
  await writeFile(join(root, 'base.txt'), 'base\n'); run(root, ['add', '.']); run(root, ['commit', '-m', 'base']);
  const repository = await GitRepository.discover(root);
  assert.throws(() => canonicalScopedPath(root, join(root, 'absolute')), /escape/);
  repository.validateWriteScope(['.'], ['base.txt']);
  repository.validateWriteScope(['src'], ['src/a.ts']);
  assert.throws(() => repository.validateWriteScope(['src'], ['README.md']), /outside write scope/);
  await repository.integrateTaskWorktree(root);
  await writeFile(join(root, 'new.txt'), 'new');
  assert.deepEqual(await repository.changedFiles(), ['new.txt']);
  await assert.rejects(GitRepository.discover(join(root, 'missing')), /not found/);
});

test('git status preserves leading status columns and tracks modified files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-modified-'));
  run(root, ['init']); run(root, ['config', 'user.email', 'x@example.com']); run(root, ['config', 'user.name', 'X']);
  await writeFile(join(root, 'tracked.txt'), 'before\n'); run(root, ['add', '.']); run(root, ['commit', '-m', 'base']);
  const repository = await GitRepository.discover(root);
  await writeFile(join(root, 'tracked.txt'), 'after\n');
  assert.deepEqual(await repository.changedFiles(), ['tracked.txt']);
});

test('isolated integration includes untracked files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-untracked-'));
  run(root, ['init']); run(root, ['config', 'user.email', 'x@example.com']); run(root, ['config', 'user.name', 'X']);
  await writeFile(join(root, 'base.txt'), 'base\n'); run(root, ['add', '.']); run(root, ['commit', '-m', 'base']);
  const repository = await GitRepository.discover(root);
  const worktree = await repository.createTaskWorktree('run-untracked', 'write');
  await writeFile(join(worktree, 'created.txt'), 'created\n');
  await repository.integrateTaskWorktree(worktree);
  assert.equal(await readContent(join(root, 'created.txt')), 'created\n');
  await repository.cleanupTaskWorktree(worktree);
});

test('parallel isolated integrations are serialized without losing changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-git-parallel-'));
  run(root, ['init']); run(root, ['config', 'user.email', 'x@example.com']); run(root, ['config', 'user.name', 'X']);
  await writeFile(join(root, 'base.txt'), 'base\n'); run(root, ['add', '.']); run(root, ['commit', '-m', 'base']);
  const repository = await GitRepository.discover(root);
  const left = await repository.createTaskWorktree('parallel', 'left');
  const right = await repository.createTaskWorktree('parallel', 'right');
  await writeFile(join(left, 'left.txt'), 'left\n');
  await writeFile(join(right, 'right.txt'), 'right\n');
  await Promise.all([repository.integrateTaskWorktree(left), repository.integrateTaskWorktree(right)]);
  assert.equal(await readContent(join(root, 'left.txt')), 'left\n');
  assert.equal(await readContent(join(root, 'right.txt')), 'right\n');
  await repository.cleanupRunWorktrees('parallel');
});
