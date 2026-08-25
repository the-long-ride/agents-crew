import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadConfig, saveConfig, starterConfig } from '../dist/config/config.js';
import { store } from '../dist/orchestration/engine.js';
import { managerStart } from '../dist/orchestration/manager.js';
import {
  classifyPrompt, normalizePrompt, PromptOrchestrator, requestHash, resolveOrchestrationWorkspace,
} from '../dist/orchestration/prompt-orchestrator.js';

test('normalizes prompts and hashes equivalent whitespace identically', () => {
  const root = '/repo';
  assert.equal(normalizePrompt('  fix   auth\n reconnect  '), 'fix auth reconnect');
  assert.equal(requestHash(root, 'fix   auth'), requestHash(root, ' fix auth '));
  assert.throws(() => normalizePrompt('   '), /must not be empty/);
});

test('classifies prompt complexity without forcing a fixed crew', () => {
  assert.equal(classifyPrompt('fix typo'), 'tiny');
  assert.equal(classifyPrompt('inspect auth and fix reconnect'), 'normal');
  assert.equal(classifyPrompt('inspect auth, fix reconnect, add focused tests'), 'complex');
});

test('orchestration resolves nested working directories to the repository root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-root-'));
  assert.equal(spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' }).status, 0);
  const nested = join(root, 'src', 'feature');
  await mkdir(nested, { recursive: true });
  const resolvedRoot = await resolveOrchestrationWorkspace(nested);
  assert.equal(await realpath(resolvedRoot), await realpath(root));

  const result = await new PromptOrchestrator().execute({ workspace: nested, host: 'opencode', prompt: 'fix typo', mode: 'plan-only' });
  assert.equal(existsSync(join(resolvedRoot, '.agents-crew', 'config.toml')), true);
  assert.equal(existsSync(join(nested, '.agents-crew')), false);
  assert.equal(await realpath((await store(resolvedRoot).load(result.run_id)).repository), await realpath(root));
});

test('auto-bootstrap uses invoking host and matching prompt resumes active run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-'));
  const orchestrator = new PromptOrchestrator();
  const first = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' });
  assert.equal(first.resumed, false);
  assert.equal(first.status, 'working');
  assert.equal(existsSync(join(root, '.agents-crew', 'config.toml')), true);
  assert.equal((await loadConfig(join(root, '.agents-crew', 'config.toml'))).manager.host, 'opencode');

  const second = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: '  inspect   auth  ', mode: 'plan-only' });
  assert.equal(second.run_id, first.run_id);
  assert.equal(second.resumed, true);

  const third = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'inspect billing', mode: 'plan-only' });
  assert.notEqual(third.run_id, first.run_id);
  assert.equal(third.resumed, false);
});

test('concurrent equivalent prompt calls serialize onto one durable run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-concurrent-'));
  const orchestrator = new PromptOrchestrator();
  const [first, second] = await Promise.all([
    orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' }),
    orchestrator.execute({ workspace: root, host: 'opencode', prompt: ' inspect  auth ', mode: 'plan-only' }),
  ]);
  assert.equal(first.run_id, second.run_id);
  assert.deepEqual([first.resumed, second.resumed].sort(), [false, true]);
});

test('missing metadata resumes only runs proven to originate from prompt orchestration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-metadata-'));
  const orchestrator = new PromptOrchestrator();
  const first = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' });
  await rm(join(store(root).runDir(first.run_id), 'orchestration.json'));
  const resumed = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' });
  assert.equal(resumed.run_id, first.run_id);
  assert.equal(resumed.resumed, true);

  const manualRoot = await mkdtemp(join(tmpdir(), 'agents-crew-manual-run-'));
  await saveConfig(join(manualRoot, '.agents-crew', 'config.toml'), starterConfig());
  const manual = await managerStart(manualRoot, 'inspect auth', 'claude-code');
  const prompted = await orchestrator.execute({ workspace: manualRoot, host: 'opencode', prompt: 'inspect auth', mode: 'plan-only' });
  assert.notEqual(prompted.run_id, manual.run_id);
  assert.equal(prompted.resumed, false);
});

test('existing workspace config is preserved while a new run uses the invoking host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-config-'));
  const config = starterConfig();
  config.manager.host = 'codex';
  config.permissions.network = 'deny';
  await saveConfig(join(root, '.agents-crew', 'config.toml'), config);

  const result = await new PromptOrchestrator().execute({ workspace: root, host: 'opencode', prompt: 'fix typo', mode: 'plan-only' });
  const loaded = await loadConfig(join(root, '.agents-crew', 'config.toml'));
  const snapshot = await loadConfig(join(store(root).runDir(result.run_id), 'crew.snapshot.toml'));
  const run = await store(root).load(result.run_id);
  assert.equal(loaded.manager.host, 'codex');
  assert.equal(loaded.permissions.network, 'deny');
  assert.equal(snapshot.manager.host, 'opencode');
  assert.equal(run.manager.host, 'opencode');
});

test('dynamic starter DAG scales with request complexity while honoring default review policy', async () => {
  const cases = [
    ['fix typo', ['implement', 'review']],
    ['inspect auth and fix reconnect', ['inspect', 'implement', 'verify', 'review']],
    ['inspect auth, fix reconnect, add focused tests', ['research', 'implement', 'verify', 'review']],
  ];
  for (const [prompt, taskIds] of cases) {
    const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-dag-'));
    const result = await new PromptOrchestrator().execute({ workspace: root, host: 'claude-code', prompt, mode: 'plan-only' });
    const run = await store(root).load(result.run_id);
    assert.deepEqual(Object.keys(run.tasks), taskIds);
    assert.equal(run.workspace_mode, 'current');
    const metadata = JSON.parse(await readFile(join(store(root).runDir(run.id), 'orchestration.json'), 'utf8'));
    assert.equal(metadata.request_hash, requestHash(root, prompt));
    assert.equal(metadata.host, 'claude-code');
    assert.equal(metadata.phase, 'planning');
  }
});

test('review policy can explicitly remove review from a tiny prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-review-'));
  const config = starterConfig();
  config.verification.require_independent_review = false;
  await saveConfig(join(root, '.agents-crew', 'config.toml'), config);
  const result = await new PromptOrchestrator().execute({ workspace: root, host: 'codex', prompt: 'fix typo', mode: 'plan-only' });
  const run = await store(root).load(result.run_id);
  assert.deepEqual(Object.keys(run.tasks), ['implement']);
});

test('high-level result exposes pending approvals needed by the invoking host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-approval-'));
  const config = starterConfig();
  config.permissions.local_edit = 'ask';
  config.verification.require_independent_review = false;
  await saveConfig(join(root, '.agents-crew', 'config.toml'), config);
  const result = await new PromptOrchestrator().execute({ workspace: root, host: 'opencode', prompt: 'fix typo' });
  assert.equal(result.status, 'awaiting_approval');
  assert.equal(result.actions.length, 0);
  assert.equal(result.pending_approvals.length, 1);
  assert.match(result.pending_approvals[0].operation, /^task:implement:local_edit$/u);
  assert.ok(result.pending_approvals[0].id);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.verification, []);
});

test('resumed orchestration executes with the run snapshot instead of later workspace config edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-prompt-snapshot-'));
  assert.equal(spawnSync('git', ['init'], { cwd: root, stdio: 'ignore' }).status, 0);
  const orchestrator = new PromptOrchestrator();
  const first = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'fix typo', mode: 'plan-only' });
  const current = await loadConfig(join(root, '.agents-crew', 'config.toml'));
  current.permissions.local_edit = 'deny';
  await saveConfig(join(root, '.agents-crew', 'config.toml'), current);

  const resumed = await orchestrator.execute({ workspace: root, host: 'opencode', prompt: 'fix typo' });
  assert.equal(resumed.run_id, first.run_id);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.status, 'manager_required');
  assert.equal(resumed.actions[0]?.action?.type, 'dispatch_native');
});
