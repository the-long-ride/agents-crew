import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStatePaths, JsonStateStore, migrateAgentBridgeV1 } from '../dist/index.js';

test('state paths use .agents-crew by default', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-state-'));
  const paths = createStatePaths(workspace);
  assert.equal(path.basename(paths.directory), '.agents-crew');
  assert.equal(path.basename(paths.task), 'TASK.json');
  assert.equal(path.basename(paths.turns), 'TURNS.jsonl');
  assert.equal(path.basename(paths.lock), 'LOCK.json');
  assert.equal(path.basename(paths.disabled), 'DISABLED');
  assert.equal(path.basename(paths.ready), 'READY.json');
  assert.equal(path.basename(paths.review), 'REVIEW.json');
  assert.equal(path.basename(paths.context), 'CONTEXT.md');
  assert.equal(path.basename(paths.needsHuman), 'NEEDS_HUMAN.md');
});

test('state paths accepts custom directory name', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-custom-'));
  const paths = createStatePaths(workspace, '.custom');
  assert.equal(path.basename(paths.directory), '.custom');
});

test('json store writes task atomically', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-store-'));
  const paths = createStatePaths(workspace);
  const store = new JsonStateStore(paths);
  await store.writeTask({ schemaVersion: 1, taskId: 'task-1' });
  assert.equal(JSON.parse(await readFile(paths.task, 'utf8')).taskId, 'task-1');
});

test('json store writes ready atomically', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-ready-'));
  const paths = createStatePaths(workspace);
  const store = new JsonStateStore(paths);
  await store.writeReady({ taskId: 'task-1', diffHash: 'abc' });
  const ready = JSON.parse(await readFile(paths.ready, 'utf8'));
  assert.equal(ready.taskId, 'task-1');
});

test('json store writes review atomically', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-review-'));
  const paths = createStatePaths(workspace);
  const store = new JsonStateStore(paths);
  await store.writeReview({ status: 'pass', summary: 'ok', findings: [] });
  const review = JSON.parse(await readFile(paths.review, 'utf8'));
  assert.equal(review.status, 'pass');
});

test('json store readTask returns null when missing', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-read-'));
  const paths = createStatePaths(workspace);
  const store = new JsonStateStore(paths);
  assert.equal(store.readTask(), null);
  assert.equal(store.readReady(), null);
  assert.equal(store.readReview(), null);
});

test('json store readTask returns written data', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-readwrite-'));
  const paths = createStatePaths(workspace);
  const store = new JsonStateStore(paths);
  store.writeTask({ taskId: 't-1' });
  const task = store.readTask();
  assert.equal(task.taskId, 't-1');
});

test('migration copies agent-bridge v1 task into agents-crew state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-migrate-'));
  const legacyDir = path.join(workspace, '.agent-bridge');
  await import('node:fs/promises').then(fs => fs.mkdir(legacyDir, { recursive: true }));
  await writeFile(path.join(legacyDir, 'TASK.json'), JSON.stringify({ schemaVersion: 1, taskId: 'old' }));
  const result = await migrateAgentBridgeV1(workspace);
  assert.equal(result.migrated, true);
  assert.equal(existsSync(path.join(workspace, '.agents-crew', 'TASK.json')), true);
});

test('migration returns false when no legacy state', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-nolegacy-'));
  const result = await migrateAgentBridgeV1(workspace);
  assert.equal(result.migrated, false);
  assert.equal(result.copiedFiles.length, 0);
});

test('migration does not overwrite existing files', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agents-crew-nooverwrite-'));
  const legacyDir = path.join(workspace, '.agent-bridge');
  await import('node:fs/promises').then(fs => fs.mkdir(legacyDir, { recursive: true }));
  await writeFile(path.join(legacyDir, 'TASK.json'), JSON.stringify({ taskId: 'old' }));
  const newDir = path.join(workspace, '.agents-crew');
  await import('node:fs/promises').then(fs => fs.mkdir(newDir, { recursive: true }));
  await writeFile(path.join(newDir, 'TASK.json'), JSON.stringify({ taskId: 'existing' }));
  const result = await migrateAgentBridgeV1(workspace);
  assert.equal(result.migrated, false);
  const existing = JSON.parse(await readFile(path.join(newDir, 'TASK.json'), 'utf8'));
  assert.equal(existing.taskId, 'existing');
});
