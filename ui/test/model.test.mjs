import assert from 'node:assert/strict';
import test from 'node:test';
import { modelIsAvailable, modelOptionsForCatalog, modelValueForAdapter } from '../../dist/ui/assets/builder.js';
import {
  addMember,
  edgeLayout,
  nodeLayout,
  normalizeCrew,
  removeMember,
  savePayload,
} from '../../dist/ui/assets/model.js';

function template() {
  return {
    id: 'crew',
    name: 'Crew',
    description: '',
    scope: 'global',
    config: {
      version: 1,
      template: { id: 'crew', name: 'Crew', description: '', layout: {} },
      run: {
        workspace_mode: 'current', max_iterations: 8, max_parallel_readers: 4,
        max_parallel_writers: 2, max_tasks_per_iteration: 8,
        default_task_timeout_seconds: 900, retain_failed_worktrees: true,
      },
      manager: {
        host: 'codex', coding: 'small_fixes', small_fix_max_files: 3,
        small_fix_max_changed_lines: 120,
      },
      autonomy: { mode: 'balanced' },
      permissions: {
        local_read: 'allow', local_edit: 'allow', test_commands: 'allow', network: 'ask',
        destructive_commands: 'ask', credentialed_actions: 'ask', commit: 'ask', push: 'ask', deploy: 'ask',
      },
      verification: { commands: [], require_independent_review: true, allow_same_agent_review: true },
      workers: [],
    },
  };
}

test('normalization supplies manager and worker defaults without mutating source', () => {
  const value = template();
  value.config.workers.push({ id: 'member-1', kind: 'cli' });
  const normalized = normalizeCrew(value);
  assert.equal(normalized.config.manager.alias, 'Boss');
  assert.equal(normalized.config.manager.model, '');
  assert.equal(normalized.config.workers[0].model, '');
  assert.deepEqual(normalized.config.workers[0].capabilities, ['read']);
  assert.equal(value.config.manager.alias, undefined);
});

test('worker nodes and edges receive deterministic positions', () => {
  let value = normalizeCrew(template());
  value = addMember(value);
  value = addMember(value);
  assert.equal(value.config.workers[0].model, '');
  const nodes = nodeLayout(value);
  assert.equal(nodes[0].type, 'boss');
  assert.equal(nodes[1].x, 430);
  assert.equal(nodes[2].x, 690);
  assert.equal(edgeLayout(nodes).length, 2);
});

test('saved layout overrides generated position', () => {
  let value = addMember(normalizeCrew(template()));
  value.config.template.layout['member-1'] = { x: 111, y: 222 };
  const nodes = nodeLayout(value);
  assert.equal(nodes[1].x, 111);
  assert.equal(nodes[1].y, 222);
});

test('removing a worker also removes its layout', () => {
  let value = addMember(normalizeCrew(template()));
  value.config.template.layout['member-1'] = { x: 10, y: 20 };
  value = removeMember(value, 'member-1');
  assert.equal(value.config.workers.length, 0);
  assert.equal(value.config.template.layout['member-1'], undefined);
});

test('save payload carries selected scope and cloned config', () => {
  const value = normalizeCrew(template());
  const payload = savePayload(value, 'workspace');
  assert.equal(payload.scope, 'workspace');
  assert.equal(payload.config.template.id, 'crew');
  payload.config.template.name = 'Changed';
  assert.equal(value.config.template.name, 'Crew');
});


test('catalog model values follow adapter conventions and reject stale data', () => {
  const catalog = {
    host: 'opencode', providers: ['anthropic', 'openai'], source: 'live', stale: false,
    models: [
      { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic', reasoning: true, tool_call: true, attachment: false },
      { id: 'gpt-codex', name: 'GPT Codex', provider: 'openai', reasoning: true, tool_call: true, attachment: false },
    ],
  };
  assert.equal(modelValueForAdapter('opencode', catalog.models[0]), 'anthropic/claude-sonnet');
  assert.equal(modelValueForAdapter('claude-code', catalog.models[0]), 'claude-sonnet');
  assert.deepEqual(modelOptionsForCatalog(catalog).map((option) => option.value), ['anthropic/claude-sonnet', 'openai/gpt-codex']);
  assert.deepEqual(modelOptionsForCatalog({ ...catalog, source: 'stale', stale: true }), []);
  assert.equal(modelIsAvailable('opencode', 'anthropic/claude-sonnet', catalog), true);
  assert.equal(modelIsAvailable('opencode', 'claude-sonnet', catalog), false);
  assert.equal(modelIsAvailable('opencode', '', catalog), true);
  assert.equal(modelIsAvailable('opencode', 'anthropic/claude-sonnet', { ...catalog, source: 'stale', stale: true }), false);
});

test('WebUI source exposes Connect as a first-class view and Runtime process region', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../static/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-view="connect"[^>]*>Connect</u);
  assert.match(html, /id="connect-view"/u);
  assert.match(html, /id="process-list"/u);
  assert.match(html, /Crew Processes/u);
});
