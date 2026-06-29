import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { starterConfig } from '../../dist/config/config.js';
import { createRun, createTask } from '../../dist/domain/core.js';
import { RunProtocol } from '../../dist/orchestration/protocol.js';
import { RunStore } from '../../dist/runtime/state.js';
import { apiTokenMatches, createUiServer, openBrowser, safeStaticPath } from '../../dist/ui/server.js';

test('UI static paths stay inside their root', () => {
  const root = join(tmpdir(), 'crew-ui');
  assert.equal(safeStaticPath(root, '/index.html'), join(root, 'index.html'));
  assert.throws(() => safeStaticPath(root, '/../secret'), /invalid static path/);
  assert.equal(apiTokenMatches({ headers: { 'x-agents-crew-token': 'secret' } }, 'secret'), true);
  assert.equal(apiTokenMatches({ headers: {} }, 'secret'), false);
});



test('browser launch errors are contained and detached', () => {
  let errorListener;
  let detached = false;
  const child = {
    once(event, listener) {
      assert.equal(event, 'error');
      errorListener = listener;
      return this;
    },
    unref() { detached = true; },
  };
  openBrowser('http://127.0.0.1:1234/', () => child);
  assert.equal(typeof errorListener, 'function');
  assert.doesNotThrow(() => errorListener(new Error('launcher missing')));
  assert.equal(detached, true);
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('UI API requires its launch token and uses durable run controls', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-ui-api-'));
  const config = starterConfig();
  const run = createRun('UI test', root, 'current', config.manager, config.run.max_iterations);
  run.status = 'working';
  run.tasks.inspect = createTask('inspect', {
    title: 'Inspect', instructions: 'Inspect', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'findings', max_attempts: 2,
  });
  const store = new RunStore(root);
  await store.create(run);
  await new RunProtocol(root).materialize(run, config, {
    template_id: 'test', template_name: 'Test', goal: run.original_goal,
    expectations: [], acceptance_criteria: [], constraints: [],
  });
  await store.appendEvent(run.id, 'ui_test_event', { source: 'test' });

  const token = 'test-token';
  const server = createUiServer(root, token);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = await listen(server);
  const headers = { 'x-agents-crew-token': token };

  assert.equal((await fetch(`${base}/api/runs`)).status, 401);
  const list = await fetch(`${base}/api/runs`, { headers });
  assert.equal(list.status, 200);
  const summaries = (await list.json()).runs;
  assert.equal(summaries[0].id, run.id);
  assert.equal(summaries[0].manager, config.manager.host);
  assert.equal(summaries[0].completed_tasks, 0);
  assert.equal(summaries[0].total_tasks, 1);

  const detailResponse = await fetch(`${base}/api/runs/${run.id}`, { headers });
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.events.some((event) => event.kind === 'ui_test_event'), true);
  assert.equal(detail.files.includes('run.json'), true);
  assert.equal(detail.files.some((file) => file.startsWith('context/')), true);

  const paused = await fetch(`${base}/api/runs/${run.id}/pause`, { method: 'POST', headers, body: '{}' });
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).run.status, 'paused');

  const resumed = await fetch(`${base}/api/runs/${run.id}/resume`, { method: 'POST', headers, body: '{}' });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).run.status, 'manager_required');

  const oversized = await fetch(`${base}/api/runs/${run.id}/pause`, {
    method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);

  const invalidJson = await fetch(`${base}/api/runs/${run.id}/pause`, { method: 'POST', headers, body: '{' });
  assert.equal(invalidJson.status, 400);
  assert.equal((await fetch(`${base}/%2E%2E%2Fsecret`, { headers })).status, 400);

  const cancelled = await fetch(`${base}/api/runs/${run.id}/cancel`, { method: 'POST', headers, body: '{}' });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).run.status, 'cancelled');
  assert.equal((await fetch(`${base}/missing`, { headers })).status, 404);

  const activeRuns = await fetch(`${base}/api/runs?archived=active`, { headers });
  assert.deepEqual((await activeRuns.json()).runs, []);
  const historyRuns = await fetch(`${base}/api/runs?archived=history`, { headers });
  assert.equal((await historyRuns.json()).runs[0].id, run.id);
  assert.equal((await fetch(`${base}/api/runs?archived=bad`, { headers })).status, 400);
});

test('UI bootstrap and template routes restore the control-plane data model', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-ui-templates-'));
  const token = 'template-token';
  const server = createUiServer(root, token);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = await listen(server);
  const headers = { 'x-agents-crew-token': token, 'content-type': 'application/json' };

  const bootstrapResponse = await fetch(`${base}/api/bootstrap`, { headers });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  assert.equal(bootstrap.templates[0].id, 'default');
  assert.equal(bootstrap.templates[0].scope, 'builtin');
  assert.deepEqual(bootstrap.roles, ['planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator']);
  assert.ok(bootstrap.capabilities.includes('write'));
  assert.ok(bootstrap.model_presets.includes('configured-by-user'));
  assert.deepEqual(bootstrap.history_runs, []);

  const modelResponse = await fetch(`${base}/api/models?host=custom-cli`, { headers });
  assert.equal(modelResponse.status, 200);
  assert.deepEqual((await modelResponse.json()).models, []);

  const config = starterConfig();
  config.template = { id: 'focused', name: 'Focused crew', description: 'Focused work', layout: {} };
  const savedResponse = await fetch(`${base}/api/templates/focused`, {
    method: 'PUT', headers, body: JSON.stringify({ scope: 'workspace', config }),
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.scope, 'workspace');
  assert.equal(saved.name, 'Focused crew');

  const listResponse = await fetch(`${base}/api/templates`, { headers });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).some((item) => item.id === 'focused'), true);

  const getResponse = await fetch(`${base}/api/templates/focused`, { headers });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).description, 'Focused work');

  const mismatched = structuredClone(config);
  mismatched.template.id = 'other';
  assert.equal((await fetch(`${base}/api/templates/focused`, {
    method: 'PUT', headers, body: JSON.stringify({ scope: 'workspace', config: mismatched }),
  })).status, 400);
  assert.equal((await fetch(`${base}/api/templates/focused`, {
    method: 'PUT', headers, body: JSON.stringify({ scope: 'builtin', config }),
  })).status, 400);
  assert.equal((await fetch(`${base}/api/templates/default?scope=builtin`, { method: 'DELETE', headers })).status, 400);

  const deleted = await fetch(`${base}/api/templates/focused?scope=workspace`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: 'focused', scope: 'workspace' });
  assert.equal((await fetch(`${base}/api/templates/focused`, { headers })).status, 404);
});
