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

test('agent CLI parser exposes subcommand and positional arguments', () => {
  const parsed = api.parseArgs(['--json', 'agent', 'register', 'codex-1', '--provider', 'codex', '--roles', 'implementer,reviewer', '--capabilities', 'read,write']);
  assert.equal(parsed.command, 'agent');
  assert.equal(parsed.args.subcommand, 'register');
  assert.deepEqual(parsed.args.positional, ['codex-1']);
  assert.equal(parsed.args.roles, 'implementer,reviewer');
});

test('agent capabilities are available without initializing or advancing a run', async () => {
  const dispatchAgentCommand = requireAgentCommand();
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-agent-cli-'));
  const result = await dispatchAgentCommand({ workspace: root, json: true, command: 'agent', args: { subcommand: 'capabilities', positional: [] } });
  assert.equal(result.protocol, 'agents-crew-agent-mesh/1');
  assert.equal(result.a2a, '1.0');
  assert.deepEqual(result.operations, ['register', 'list', 'heartbeat', 'claim', 'release', 'send', 'inbox', 'capabilities']);
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
