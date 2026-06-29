import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dispatchCommand } from '../dist/cli/commands.js';
import { starterConfig } from '../dist/config/config.js';
import { TemplateRegistry } from '../dist/templates/registry.js';

function command(workspace, name, args = {}) {
  return dispatchCommand({ workspace, json: true, command: name, args });
}

test('command router covers setup, templates, plugins, planning, and durable controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-commands-'));
  assert.equal((await command(root, 'init', { non_interactive: true })).initialized, true);
  assert.equal((await command(root, 'config', { subcommand: 'validate', positional: [] })).valid, true);
  assert.equal((await command(root, 'config', { subcommand: 'show', positional: [] })).version, 1);
  assert.deepEqual((await command(root, 'plugin', { subcommand: 'list', positional: [] })).hosts, ['codex', 'claude-code', 'opencode', 'antigravity']);

  const installed = await command(root, 'plugin', { subcommand: 'install', positional: ['codex'] });
  assert.equal(installed.host, 'codex');
  assert.equal((await command(root, 'plugin', { subcommand: 'doctor', positional: ['codex'] })).host, 'codex');
  assert.equal((await command(root, 'plugin', { subcommand: 'uninstall', positional: ['codex'] })).host, 'codex');

  const templateConfig = starterConfig();
  templateConfig.template = { id: 'focused', name: 'Focused', description: 'Focused team', layout: {} };
  await new TemplateRegistry(root, join(root, 'global-templates')).save('workspace', templateConfig);
  assert.equal((await command(root, 'template', { subcommand: 'show', positional: ['focused'] })).name, 'Focused');
  assert.equal((await command(root, 'template', { subcommand: 'validate', positional: ['focused'] })).valid, true);
  assert.equal((await command(root, 'template', { subcommand: 'list', positional: [] })).templates.some((item) => item.id === 'focused'), true);
  assert.equal((await command(root, 'template', { subcommand: 'delete', positional: ['focused'], scope: 'workspace' })).deleted, true);

  assert.equal((await command(root, 'plan', { goal: 'review commands' })).run.tasks.implement.role, 'implementer');
  const started = await command(root, 'run', { goal: 'inspect project' });
  assert.equal(started.run.status, 'manager_required');
  assert.equal((await command(root, 'status', { run_id: started.run.id })).run.id, started.run.id);
  assert.equal((await command(root, 'pause', { run_id: started.run.id })).status, 'paused');
  assert.equal((await command(root, 'resume', { run_id: started.run.id })).run.status, 'manager_required');
  assert.equal((await command(root, 'cancel', { run_id: started.run.id })).status, 'cancelled');
});

test('command router rejects unknown commands and invalid subcommands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-command-errors-'));
  await command(root, 'init', {});
  await assert.rejects(command(root, 'unknown'), /unknown command/);
  await assert.rejects(command(root, 'config', { subcommand: 'bad', positional: [] }), /unknown config subcommand/);
  await assert.rejects(command(root, 'template', { subcommand: 'delete', positional: ['default'], scope: 'builtin' }), /cannot be deleted/);
  await assert.rejects(command(root, 'status', {}), /no run found/);
  const unsafeTask = join(root, 'unsafe-task.json');
  await writeFile(unsafeTask, JSON.stringify({
    id: '../escape', title: 'bad', instructions: 'bad', role: 'researcher', capabilities: ['read'], write_scope: [],
    dependencies: [], preferred_workers: [], expected_output: 'bad', max_attempts: 1,
  }));
  await assert.rejects(command(root, 'worker', { subcommand: 'run', positional: ['manager-native', unsafeTask] }), /invalid task id/);
});
