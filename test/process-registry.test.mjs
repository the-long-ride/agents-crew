import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProcessRegistry } from '../dist/runtime/process-registry.js';

async function workspace() { return mkdtemp(join(tmpdir(), 'agents-crew-processes-')); }

function input(overrides = {}) {
  return {
    worker_id: 'worker-a', host: 'codex', pid: process.pid, run_id: 'run-a', task_id: 'task-a',
    workspace: '/repo', started_at: new Date().toISOString(), ...overrides,
  };
}

test('process registry records lifecycle without prompts or environment data', async () => {
  const root = await workspace();
  const registry = new ProcessRegistry(root);
  const record = await registry.register(input());
  assert.equal(record.state, 'running');
  assert.equal(record.pid, process.pid);
  assert.equal(JSON.stringify(record).includes('prompt'), false);
  assert.equal(JSON.stringify(record).includes('env'), false);

  await registry.update(record.id, { state: 'pausing' });
  assert.equal((await registry.get(record.id)).state, 'pausing');
  await registry.complete(record.id, 'paused', 0);
  assert.equal((await registry.get(record.id)).state, 'paused');
});

test('process registry validates and atomically consumes stop/restart controls', async () => {
  const root = await workspace();
  const registry = new ProcessRegistry(root);
  const record = await registry.register(input());
  await assert.rejects(registry.requestControl(record.id, 'pause'), /control action/i);
  await registry.requestControl(record.id, 'restart');
  assert.equal((await registry.consumeControl(record.id))?.action, 'restart');
  assert.equal(await registry.consumeControl(record.id), undefined);
  await registry.requestControl(record.id, 'stop');
  assert.equal((await registry.consumeControl(record.id))?.action, 'stop');
});

test('process registry marks dead active pids stale and prunes old terminal records', async () => {
  const root = await workspace();
  let now = Date.now();
  const registry = new ProcessRegistry(root, { now: () => now, retention_ms: 1000 });
  const stale = await registry.register(input({ pid: 99999999, started_at: new Date(now).toISOString() }));
  const listed = await registry.list();
  assert.equal(listed.find((item) => item.id === stale.id).state, 'failed');
  assert.match(listed.find((item) => item.id === stale.id).message, /no longer alive/i);
  now += 2000;
  await registry.prune();
  assert.equal(await registry.get(stale.id), undefined);
});
