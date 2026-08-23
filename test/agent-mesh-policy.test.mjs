import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as api from '../dist/index.js';

async function workspace(permissionOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-mesh-policy-'));
  const config = api.starterConfig();
  Object.assign(config.permissions, permissionOverrides);
  const run = api.createRun('peer policy work', root, 'current', {
    host: 'codex', coding: 'never', small_fix_max_files: 1, small_fix_max_changed_lines: 20,
  }, 3);
  run.id = 'run-policy';
  run.status = 'working';
  run.tasks['guarded'] = api.createTask('guarded', {
    title: 'Guarded peer task',
    instructions: 'perform guarded work',
    role: 'implementer',
    capabilities: ['read', 'push'],
    write_scope: [],
    dependencies: [],
    preferred_workers: [],
    expected_output: 'done',
    max_attempts: 2,
  });
  run.tasks.guarded.status = 'ready';
  const store = new api.RunStore(root);
  await store.create(run);
  await new api.RunProtocol(root).materialize(run, config, {
    template_id: 'peer-policy', template_name: 'Peer policy', goal: run.original_goal,
    expectations: [], acceptance_criteria: [], constraints: [],
  });
  return { root, store, run };
}

async function registerWorker(mesh) {
  return mesh.register({
    id: 'peer', provider: 'codex', roles: ['implementer'], capabilities: ['read', 'push'], interfaces: [],
  });
}

test('peer claims cannot bypass denied guarded task policy', async () => {
  const { root, store } = await workspace({ push: 'deny' });
  const mesh = new api.AgentMesh(root);
  await registerWorker(mesh);
  await assert.rejects(() => mesh.claimTask('run-policy', 'guarded', 'peer', 60), /policy denied push/u);
  const persisted = await store.load('run-policy');
  assert.equal(persisted.tasks.guarded.status, 'ready');
  assert.equal(persisted.tasks.guarded.assigned_worker, undefined);
  assert.equal(persisted.approvals.length, 0);
});

test('peer claims persist ask approvals and can continue after approval', async () => {
  const { root, store } = await workspace({ push: 'ask' });
  const mesh = new api.AgentMesh(root);
  await registerWorker(mesh);
  await assert.rejects(() => mesh.claimTask('run-policy', 'guarded', 'peer', 60), /approval required/u);

  const blocked = await store.load('run-policy');
  assert.equal(blocked.status, 'awaiting_approval');
  assert.equal(blocked.tasks.guarded.status, 'blocked');
  const approval = blocked.approvals.find((item) => item.operation === 'task:guarded:push');
  assert.ok(approval);
  assert.equal(approval.status, 'pending');

  await api.decideRunApproval(root, 'run-policy', approval.id, true);
  const lease = await mesh.claimTask('run-policy', 'guarded', 'peer', 60);
  assert.equal(lease.agent_id, 'peer');
  const running = await store.load('run-policy');
  assert.equal(running.tasks.guarded.status, 'running');
  assert.equal(running.tasks.guarded.assigned_worker, 'peer');
});

test('credentialed A2A direct delivery requires credential policy allow', async () => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { message: { role: 'ROLE_AGENT', parts: [{ text: 'ok' }], messageId: 'reply' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const original = process.env.AGENTS_CREW_TEST_AUTH;
  process.env.AGENTS_CREW_TEST_AUTH = 'Bearer test';
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const permission of ['ask', 'deny', 'allow']) {
      const { root } = await workspace({ network: 'allow', credentialed_actions: permission });
      const mesh = new api.AgentMesh(root);
      await mesh.register({ id: 'sender', roles: ['implementer'], capabilities: ['read', 'network'], interfaces: [] });
      await mesh.register({
        id: 'recipient', roles: ['reviewer'], capabilities: ['read'], interfaces: [{
          kind: 'a2a', url: `http://127.0.0.1:${address.port}`, headers_env: { authorization: 'AGENTS_CREW_TEST_AUTH' },
        }],
      });
      const sent = await mesh.sendMessage('run-policy', {
        from: 'sender', to: 'recipient', kind: 'request', body: permission,
      });
      assert.equal(sent.delivery, permission === 'allow' ? 'a2a' : 'mailbox');
    }
    assert.equal(requests, 1);
  } finally {
    if (original === undefined) delete process.env.AGENTS_CREW_TEST_AUTH;
    else process.env.AGENTS_CREW_TEST_AUTH = original;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('terminal archive preserves durable peer communication audit', async () => {
  const { root, store } = await workspace();
  const mesh = new api.AgentMesh(root);
  await mesh.register({ id: 'sender', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
  await mesh.register({ id: 'recipient', roles: ['reviewer'], capabilities: ['read'], interfaces: [] });
  const sent = await mesh.sendMessage('run-policy', {
    from: 'sender', to: 'recipient', kind: 'message', body: 'retain after archive',
  });
  assert.equal(sent.delivery, 'mailbox');

  const run = await store.load('run-policy');
  run.status = 'completed';
  run.terminal_summary = 'done';
  await store.save(run);
  await new api.RunProtocol(root).archiveTerminal(run);

  const inbox = await new api.AgentMesh(root).inbox('run-policy', 'recipient');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].body, 'retain after archive');
});

test('one-time actions keep a single winner under repeated same-process contention', async () => {
  const { root, store } = await workspace();
  for (let index = 0; index < 30; index += 1) {
    const id = `once-${index}`;
    await store.saveAction({
      id, run_id: 'run-policy', issued_at: new Date().toISOString(), capability_envelope: [],
      action: { type: 'display', message: 'once' }, consumed: false,
    });
    const settled = await Promise.allSettled([
      store.consumeAction('run-policy', id, []),
      store.consumeAction('run-policy', id, []),
    ]);
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1, `iteration ${index}`);
    assert.equal(settled.filter((item) => item.status === 'rejected').length, 1, `iteration ${index}`);
  }
});
