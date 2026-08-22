import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as api from '../dist/index.js';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-mesh-'));
  await mkdir(join(root, '.agents-crew', 'active', 'run-1'), { recursive: true });
  const run = api.createRun('peer work', root, 'current', {
    host: 'codex', coding: 'never', small_fix_max_files: 1, small_fix_max_changed_lines: 20,
  }, 3);
  run.id = 'run-1';
  run.status = 'working';
  run.tasks['task-1'] = api.createTask('task-1', {
    title: 'Peer task', instructions: 'coordinate directly', role: 'implementer', capabilities: ['read'],
    write_scope: [], dependencies: [], preferred_workers: [], expected_output: 'done', max_attempts: 2,
  });
  run.tasks['task-1'].status = 'ready';
  await new api.RunStore(root).save(run);
  return root;
}

function requireMesh() {
  assert.equal(typeof api.AgentMesh, 'function', 'AgentMesh must be exported');
  return api.AgentMesh;
}

function message() {
  return {
    id: 'msg-1', run_id: 'run-1', from: 'a', to: 'b', kind: 'request', body: 'review task',
    task_id: 'task-1', created_at: new Date().toISOString(), delivery: 'mailbox',
  };
}

test('registers and lists peer agents durably', async () => {
  const AgentMesh = requireMesh();
  const root = await workspace();
  const mesh = new AgentMesh(root);
  await mesh.register({ id: 'codex-1', provider: 'codex', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
  const agents = await new AgentMesh(root).listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].id, 'codex-1');
  assert.equal(agents[0].provider, 'codex');
});

test('task leases are exclusive and expired leases are reclaimable', async () => {
  const AgentMesh = requireMesh();
  const root = await workspace();
  const mesh = new AgentMesh(root);
  await mesh.register({ id: 'a', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
  await mesh.register({ id: 'b', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
  const first = await mesh.claimTask('run-1', 'task-1', 'a', 60);
  assert.equal(first.agent_id, 'a');
  await assert.rejects(() => mesh.claimTask('run-1', 'task-1', 'b', 60), /leased by a/u);
  await mesh.releaseTask('run-1', 'task-1', 'a');
  const second = await mesh.claimTask('run-1', 'task-1', 'b', 0);
  assert.equal(second.agent_id, 'b');
  const third = await mesh.claimTask('run-1', 'task-1', 'a', 60);
  assert.equal(third.agent_id, 'a');
  assert.ok(third.revision > second.revision);
});

test('messages are durable and readable from recipient inbox', async () => {
  const AgentMesh = requireMesh();
  const root = await workspace();
  const mesh = new AgentMesh(root);
  await mesh.register({ id: 'a', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
  await mesh.register({ id: 'b', roles: ['reviewer'], capabilities: ['read'], interfaces: [] });
  const sent = await mesh.sendMessage('run-1', { from: 'a', to: 'b', kind: 'request', body: 'review task', task_id: 'task-1' });
  assert.equal(sent.delivery, 'mailbox');
  const inbox = await new AgentMesh(root).inbox('run-1', 'b');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].body, 'review task');
  assert.equal(inbox[0].from, 'a');
});

test('A2A peers receive direct message/send while the message remains durable', async () => {
  const AgentMesh = requireMesh();
  let observed;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    observed = { headers: request.headers, body: JSON.parse(body) };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: observed.body.id, result: { message: { role: 'ROLE_AGENT', parts: [{ text: 'ok' }], messageId: 'reply-1' } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const root = await workspace();
    const mesh = new AgentMesh(root);
    await mesh.register({ id: 'a', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
    await mesh.register({ id: 'b', roles: ['reviewer'], capabilities: ['read'], interfaces: [{ kind: 'a2a', url: `http://127.0.0.1:${address.port}` }] });
    const sent = await mesh.sendMessage('run-1', { from: 'a', to: 'b', kind: 'review', body: 'review task', task_id: 'task-1' });
    assert.equal(sent.delivery, 'a2a');
    assert.equal(observed.headers['a2a-version'], '1.0');
    assert.equal(observed.body.jsonrpc, '2.0');
    assert.equal(observed.body.method, 'message/send');
    assert.equal(observed.body.params.message.messageId, sent.id);
    assert.equal(observed.body.params.message.parts[0].text, 'review task');
    const inbox = await mesh.inbox('run-1', 'b');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].delivery, 'a2a');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('A2A transport failure falls back to the durable mailbox', async () => {
  const AgentMesh = requireMesh();
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const root = await workspace();
    const mesh = new AgentMesh(root);
    await mesh.register({ id: 'a', roles: ['implementer'], capabilities: ['read'], interfaces: [] });
    await mesh.register({ id: 'b', roles: ['reviewer'], capabilities: ['read'], interfaces: [{ kind: 'a2a', url: `http://127.0.0.1:${address.port}` }] });
    const sent = await mesh.sendMessage('run-1', { from: 'a', to: 'b', kind: 'request', body: 'fallback' });
    assert.equal(sent.delivery, 'mailbox');
    assert.match(sent.direct_error, /HTTP 503/u);
    assert.equal((await mesh.inbox('run-1', 'b'))[0].body, 'fallback');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('A2A transport rejects unsupported bindings and unresolved header secrets', async () => {
  await assert.rejects(
    api.sendA2AMessage({ kind: 'a2a', url: 'https://example.invalid', protocol_binding: 'HTTP+JSON' }, message()),
    /unsupported A2A binding/u,
  );
  await assert.rejects(
    api.sendA2AMessage({ kind: 'a2a', url: 'https://example.invalid', headers_env: { authorization: 'AGENTS_CREW_TEST_MISSING' } }, message()),
    /missing A2A header environment variable/u,
  );
});
