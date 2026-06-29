import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { starterConfig } from '../dist/config/config.js';
import { TemplateRegistry, defaultGlobalTemplateRoot, validateTemplateId } from '../dist/templates/registry.js';

test('template registry applies workspace-over-global precedence and supports deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-template-'));
  const globalRoot = join(root, 'global');
  const workspace = join(root, 'workspace');
  const registry = new TemplateRegistry(workspace, globalRoot);
  const globalConfig = starterConfig();
  globalConfig.template = { id: 'team', name: 'Global team', description: 'global', layout: {} };
  await registry.save('global', globalConfig);
  assert.equal((await registry.resolve('team')).scope, 'global');

  const workspaceConfig = starterConfig();
  workspaceConfig.template = { id: 'team', name: 'Workspace team', description: 'workspace', layout: {} };
  await registry.save('workspace', workspaceConfig);
  const resolved = await registry.resolve('team');
  assert.equal(resolved.scope, 'workspace');
  assert.equal(resolved.name, 'Workspace team');
  assert.deepEqual((await registry.list()).map((item) => item.id), ['default', 'team']);

  await registry.delete('workspace', 'team');
  assert.equal((await registry.resolve('team')).scope, 'global');
  await registry.delete('global', 'team');
  await assert.rejects(registry.resolve('team'), /template not found/);
  await assert.rejects(registry.delete('global', 'team'), /template not found/);
});

test('template ids and metadata are validated at storage boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-template-invalid-'));
  const registry = new TemplateRegistry(root, join(root, 'global'));
  assert.throws(() => validateTemplateId('../escape'), /invalid template id/);
  assert.equal(defaultGlobalTemplateRoot().endsWith(join('.agents-crew', 'templates')), true);
  const previousHome = process.env.AGENTS_CREW_HOME;
  process.env.AGENTS_CREW_HOME = root;
  assert.equal(defaultGlobalTemplateRoot(), join(root, 'templates'));
  if (previousHome === undefined) delete process.env.AGENTS_CREW_HOME; else process.env.AGENTS_CREW_HOME = previousHome;
  const missingMetadata = starterConfig();
  delete missingMetadata.template;
  await assert.rejects(registry.save('workspace', missingMetadata), /template metadata is required/);
  await assert.rejects(registry.resolve('../escape'), /invalid template id/);
});
