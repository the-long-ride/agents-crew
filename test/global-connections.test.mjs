import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GlobalHostConnections } from '../dist/plugins/global-connections.js';

async function home() { return mkdtemp(join(tmpdir(), 'agents-crew-home-')); }

test('global host plans use current user-level host locations', async () => {
  const root = await home();
  const service = new GlobalHostConnections(root);

  const codex = service.planFiles('codex').map(([path]) => path.replaceAll('\\', '/'));
  assert.ok(codex.some((path) => path.includes('/.agents/skills/crew-run/SKILL.md')));
  assert.ok(codex.some((path) => path.includes('/.agents/skills/agents-crew-manager/SKILL.md')));
  assert.equal(codex.some((path) => path.includes('/.codex/prompts/')), false);

  const claude = service.planFiles('claude-code').map(([path]) => path.replaceAll('\\', '/'));
  assert.ok(claude.some((path) => path.includes('/.claude/skills/crew-run/SKILL.md')));
  assert.ok(claude.some((path) => path.includes('/.claude/agents/agents-crew-reviewer.md')));

  const opencode = service.planFiles('opencode').map(([path]) => path.replaceAll('\\', '/'));
  assert.ok(opencode.some((path) => path.includes('/.config/opencode/commands/crew-run.md')));
  assert.ok(opencode.some((path) => path.includes('/.config/opencode/agents/agents-crew-reviewer.md')));

  const antigravity = service.planFiles('antigravity').map(([path]) => path.replaceAll('\\', '/'));
  assert.ok(antigravity.some((path) => path.includes('/.gemini/config/plugins/agents-crew/plugin.json')));
  assert.ok(antigravity.some((path) => path.includes('/.gemini/config/plugins/agents-crew/skills/crew-run/SKILL.md')));
});

test('global connections support connect check modified repair and safe disconnect', async () => {
  const root = await home();
  const service = new GlobalHostConnections(root);
  const before = await service.check('claude-code');
  assert.equal(before.status, 'missing');

  const connected = await service.connect('claude-code');
  assert.equal(connected.status, 'connected');
  assert.ok(connected.files.length > 3);
  assert.ok(connected.files.every((file) => file.action === 'ok'));

  const target = service.planFiles('claude-code').find(([path]) => path.includes('crew-run'))[0];
  await writeFile(target, `${await readFile(target, 'utf8')}\nuser edit\n`);
  const modified = await service.check('claude-code');
  assert.equal(modified.status, 'modified');
  assert.ok(modified.files.some((file) => file.path === target && file.action === 'modified'));

  const repaired = await service.repair('claude-code');
  assert.equal(repaired.status, 'connected');
  assert.doesNotMatch(await readFile(target, 'utf8'), /user edit/u);

  await writeFile(target, `${await readFile(target, 'utf8')}\nkeep this edit\n`);
  const disconnected = await service.disconnect('claude-code');
  assert.equal(disconnected.status, 'modified');
  assert.match(await readFile(target, 'utf8'), /keep this edit/u);
  assert.ok(disconnected.files.some((file) => file.path === target && file.action === 'preserve'));
});

test('global connect refuses unowned files and repair does not seize them', async () => {
  const root = await home();
  const service = new GlobalHostConnections(root);
  const target = service.planFiles('opencode')[0][0];
  const { mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, 'user-owned');

  await assert.rejects(service.connect('opencode'), /unowned file/i);
  await assert.rejects(service.repair('opencode'), /unowned file/i);
  assert.equal(await readFile(target, 'utf8'), 'user-owned');
});

test('global list isolates a broken host status instead of failing all hosts', async () => {
  const root = await home();
  const service = new GlobalHostConnections(root);
  await service.connect('codex');
  const manifest = join(root, '.agents-crew', 'connections', 'codex.json');
  await writeFile(manifest, '{bad json');
  const listed = await service.list();
  assert.equal(listed.length, 4);
  assert.equal(listed.find((item) => item.host === 'codex').status, 'error');
  assert.ok(listed.some((item) => item.host === 'opencode' && item.status === 'missing'));
});
