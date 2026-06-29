import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addWorker,
  edgeLayout,
  nodeLayout,
  normalizeTemplate,
  removeWorker,
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
  value.config.workers.push({ id: 'worker-1', kind: 'cli' });
  const normalized = normalizeTemplate(value);
  assert.equal(normalized.config.manager.alias, 'Manager');
  assert.equal(normalized.config.manager.model, 'configured-by-host');
  assert.equal(normalized.config.workers[0].model, 'configured-by-user');
  assert.deepEqual(normalized.config.workers[0].capabilities, ['read']);
  assert.equal(value.config.manager.alias, undefined);
});

test('worker nodes and edges receive deterministic positions', () => {
  let value = normalizeTemplate(template());
  value = addWorker(value);
  value = addWorker(value);
  const nodes = nodeLayout(value);
  assert.equal(nodes[0].type, 'manager');
  assert.equal(nodes[1].x, 430);
  assert.equal(nodes[2].x, 690);
  assert.equal(edgeLayout(nodes).length, 2);
});

test('saved layout overrides generated position', () => {
  let value = addWorker(normalizeTemplate(template()));
  value.config.template.layout['worker-1'] = { x: 111, y: 222 };
  const nodes = nodeLayout(value);
  assert.equal(nodes[1].x, 111);
  assert.equal(nodes[1].y, 222);
});

test('removing a worker also removes its layout', () => {
  let value = addWorker(normalizeTemplate(template()));
  value.config.template.layout['worker-1'] = { x: 10, y: 20 };
  value = removeWorker(value, 'worker-1');
  assert.equal(value.config.workers.length, 0);
  assert.equal(value.config.template.layout['worker-1'], undefined);
});

test('save payload carries selected scope and cloned config', () => {
  const value = normalizeTemplate(template());
  const payload = savePayload(value, 'workspace');
  assert.equal(payload.scope, 'workspace');
  assert.equal(payload.config.template.id, 'crew');
  payload.config.template.name = 'Changed';
  assert.equal(value.config.template.name, 'Crew');
});
