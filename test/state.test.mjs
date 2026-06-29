import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { starterConfig } from '../dist/config/config.js';
import { createRun } from '../dist/domain/core.js';
import { RunProtocol } from '../dist/orchestration/protocol.js';
import { RunStore } from '../dist/runtime/state.js';

test('run store persists events and one-time capability-bounded actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-state-'));
  const store = new RunStore(root);
  const run = createRun('goal', root, 'current', {
    host: 'test', coding: 'full', small_fix_max_files: 3, small_fix_max_changed_lines: 120,
  }, 4);
  await store.create(run);
  await store.appendEvent(run.id, 'run_started', { goal: 'goal' });
  const action = {
    id: 'a1', run_id: run.id, issued_at: new Date().toISOString(), capability_envelope: ['read'],
    action: { type: 'display', message: 'hello' }, consumed: false,
  };
  await store.saveAction(action);
  assert.equal((await store.pendingActions(run.id)).length, 1);
  await store.consumeAction(run.id, 'a1', ['read']);
  await assert.rejects(() => store.consumeAction(run.id, 'a1', ['read']), /consumed/i);
  assert.equal((await store.readEvents(run.id)).length, 1);
});

test('terminal protocol compacts generated context into history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-protocol-'));
  const store = new RunStore(root);
  const run = createRun('goal', root, 'current', {
    host: 'test', coding: 'full', small_fix_max_files: 3, small_fix_max_changed_lines: 120,
  }, 4);
  await store.create(run);
  const protocol = new RunProtocol(root);
  await protocol.materialize(run, starterConfig(), {
    template_id: 'default', template_name: 'Default', goal: 'goal', expectations: [], acceptance_criteria: [], constraints: [],
  });
  run.status = 'completed';
  run.terminal_summary = 'done';
  await store.save(run);
  await protocol.archiveTerminal(run);
  await access(join(root, '.agents-crew/history', run.id, 'summary.json'));
  await assert.rejects(() => access(join(root, '.agents-crew/history', run.id, 'context')));
});

test('run store covers missing, latest, archive, expired, and capability errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-state-errors-'));
  const runStore = new RunStore(root);
  await assert.rejects(runStore.load('missing'), /not found/);
  const run = createRun('goal', root, 'current', { host: 'x', coding: 'never', small_fix_max_files: 1, small_fix_max_changed_lines: 1 }, 1);
  await runStore.create(run);
  assert.equal(await runStore.latestRunId(), run.id);
  assert.deepEqual(await runStore.readEvents(run.id), []);
  const expired = { id: 'expired', run_id: run.id, issued_at: new Date(0).toISOString(), expires_at: new Date(1).toISOString(), capability_envelope: ['read'], action: { type: 'display', message: 'x' }, consumed: false };
  await runStore.saveAction(expired);
  assert.equal((await runStore.expiredActions(run.id)).length, 1);
  await assert.rejects(runStore.consumeAction(run.id, 'expired', []), /expired/);
  const bounded = { ...expired, id: 'bounded', issued_at: new Date().toISOString(), expires_at: undefined };
  await runStore.saveAction(bounded);
  await assert.rejects(runStore.consumeAction(run.id, 'bounded', ['write']), /capability mismatch/);
  await assert.rejects(runStore.loadAction(run.id, 'unknown'), /unknown action/);
  assert.equal((await runStore.pendingActions(run.id)).some((item) => item.id === 'bounded'), true);
  await runStore.archive(run.id);
  await assert.rejects(runStore.archive(run.id), /already archived|not found/);
});

test('action consumption and event sequencing are safe under concurrency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-state-concurrency-'));
  const runStore = new RunStore(root);
  const run = createRun('goal', root, 'current', { host: 'x', coding: 'never', small_fix_max_files: 1, small_fix_max_changed_lines: 1 }, 1);
  await runStore.create(run);
  await runStore.saveAction({ id: 'once', run_id: run.id, issued_at: new Date().toISOString(), capability_envelope: [], action: { type: 'display', message: 'x' }, consumed: false });
  const consumed = await Promise.allSettled([
    runStore.consumeAction(run.id, 'once', []),
    runStore.consumeAction(run.id, 'once', []),
  ]);
  assert.equal(consumed.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(consumed.filter((item) => item.status === 'rejected').length, 1);
  await Promise.all(Array.from({ length: 20 }, (_, index) => runStore.appendEvent(run.id, 'parallel', { index })));
  const events = await runStore.readEvents(run.id);
  assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: 20 }, (_, index) => index + 1));
});

test('run and action identifiers cannot escape storage roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-state-paths-'));
  const runStore = new RunStore(root);
  assert.throws(() => runStore.activeRunDir('../escape'), /identifier/i);
  await assert.rejects(runStore.loadAction('../escape', 'x'), /identifier/i);
  await assert.rejects(runStore.loadAction('safe', '../escape'), /identifier/i);
});


test('run store rejects corrupted run and action documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-state-corrupt-'));
  const runStore = new RunStore(root);
  const run = createRun('goal', root, 'current', { host: 'x', coding: 'never', small_fix_max_files: 1, small_fix_max_changed_lines: 1 }, 1);
  await runStore.create(run);
  await writeFile(join(runStore.runDir(run.id), 'run.json'), '{"id":"other","status":"bogus","tasks":[]}\n');
  await assert.rejects(runStore.load(run.id), /invalid run document/);

  await writeFile(join(runStore.runDir(run.id), 'run.json'), `${JSON.stringify(run)}\n`);
  await writeFile(join(runStore.runDir(run.id), 'actions', 'broken.json'), '{"id":"wrong","consumed":"no"}\n');
  await assert.rejects(runStore.loadAction(run.id, 'broken'), /invalid action document/);
  await assert.rejects(runStore.pendingActions(run.id), /invalid action document/);
});
