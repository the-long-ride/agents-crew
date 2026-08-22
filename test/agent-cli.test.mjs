import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as api from '../dist/index.js';

function requireAgentCommand() {
  assert.equal(typeof api.dispatchAgentCommand, 'function', 'dispatchAgentCommand must be exported');
  return api.dispatchAgentCommand;
}

function agentCommand(workspace, subcommand, positional = [], args = {}) {
  return requireAgentCommand()({ workspace, json: true, command: 'agent', args: { ...args, subcommand, positional } });
}

async function workspaceWithTask() {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-agent-cli-'));
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

test('agent CLI parser exposes subcommand and positional arguments', () => {
  const parsed = api.parseArgs(['--json', 'agent', 'register', 'codex-1', '--provider', 'codex', '--roles', 'implementer,reviewer', '--capabilities', 'read,write']);
  assert.equal(parsed.command, 'agent');
  assert.equal(parsed.args.subcommand, 'register');
  assert.deepEqual(parsed.args.positional, ['codex-1']);
  assert.equal(parsed.args.roles, 'implementer,reviewer');
});

test('agent capabilities are available without initializing or advancing a run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-agent-capabilities-'));
  const result = await agentCommand(root, 'capabilities');
  assert.equal(result.protocol, 'agents-crew-agent-mesh/1');
  assert.equal(result.a2a, '1.0');
  assert.deepEqual(result.operations, ['register', 'list', 'heartbeat', 'claim', 'release', 'send', 'inbox', 'capabilities']);
});

test('agent command drives registry leases and mailbox without the engine loop', async () => {
  const root = await workspaceWithTask();
  const first = await agentCommand(root, 'register', ['codex-1'], { provider: 'codex', roles: 'implementer,reviewer', capabilities: 'read,write' });
  assert.equal(first.agent.id, 'codex-1');
  const second = await agentCommand(root, 'register', ['claude-1'], { provider: 'claude-code', roles: 'reviewer', capabilities: 'read' });
  assert.equal(second.agent.provider, 'claude-code');
  assert.equal((await agentCommand(root, 'list')).agents.length, 2);
  assert.equal((await agentCommand(root, 'heartbeat', ['codex-1'])).agent.id, 'codex-1');
  const claimed = await agentCommand(root, 'claim', ['run-1', 'task-1', 'codex-1'], { lease_seconds: '60' });
  assert.equal(claimed.lease.agent_id, 'codex-1');
  assert.equal((await agentCommand(root, 'release', ['run-1', 'task-1', 'codex-1'])).released, true);
  const sent = await agentCommand(root, 'send', ['run-1', 'codex-1', 'claude-1'], { kind: 'review', body: 'review task', task: 'task-1' });
  assert.equal(sent.message.delivery, 'mailbox');
  const inbox = await agentCommand(root, 'inbox', ['run-1', 'claude-1']);
  assert.equal(inbox.messages[0].body, 'review task');
});

test('agent command validates protocol operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-agent-errors-'));
  await assert.rejects(agentCommand(root, 'bad'), /unknown agent subcommand/u);
  await assert.rejects(agentCommand(root, 'claim', ['run', 'task', 'agent'], { lease_seconds: '-1' }), /lease seconds/u);
  await assert.rejects(requireAgentCommand()({ workspace: root, json: true, command: 'doctor', args: {} }), /cannot handle command/u);
});

test('compiled CLI exposes machine-readable agent capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-agent-process-'));
  const result = spawnSync(process.execPath, ['dist/cli/entry.js', '--workspace', root, '--json', 'agent', 'capabilities'], {
    cwd: process.cwd(), encoding: 'utf8', shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.protocol, 'agents-crew-agent-mesh/1');
  assert.ok(payload.operations.includes('claim'));
  assert.ok(payload.operations.includes('send'));
});
