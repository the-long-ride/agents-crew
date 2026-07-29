import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorker, nodeLayout, normalizeTemplate, removeWorker, savePayload } from './app-model.js';

const base = {
  id: 'crew', name: 'Crew', scope: 'global',
  config: { template: { id: 'crew', name: 'Crew', description: '', layout: {} }, manager: { host: 'codex' }, workers: [] }
};

test('normalization supplies editable aliases and models', () => {
  const value = normalizeTemplate(base);
  assert.equal(value.config.manager.alias, 'Manager');
  assert.equal(value.config.manager.model, 'configured-by-host');
});

test('worker nodes receive deterministic canvas positions', () => {
  const value = addWorker(addWorker(normalizeTemplate(base)));
  const nodes = nodeLayout(value);
  assert.equal(nodes[0].type, 'manager');
  assert.equal(nodes[1].x, 430);
  assert.equal(nodes[2].x, 690);
});

test('add and remove worker preserve template identity', () => {
  const added = addWorker(normalizeTemplate(base));
  assert.equal(added.config.workers.length, 1);
  const removed = removeWorker(added, added.config.workers[0].id);
  assert.equal(removed.config.workers.length, 0);
  assert.equal(removed.config.template.id, 'crew');
});

test('save payload carries selected scope', () => {
  assert.equal(savePayload(normalizeTemplate(base), 'workspace').scope, 'workspace');
});


test('saved canvas layout overrides deterministic positions', () => {
  const value = addWorker(normalizeTemplate(base));
  value.config.template.layout[value.config.workers[0].id] = { x: 111, y: 222 };
  const nodes = nodeLayout(value);
  assert.equal(nodes[1].x, 111);
  assert.equal(nodes[1].y, 222);
});
