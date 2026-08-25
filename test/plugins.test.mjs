import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';
import { HostPlugin, hosts } from '../dist/plugins/registry.js';

test('all hosts generate one-prompt orchestration plus explicit advanced action protocol', () => {
  for (const host of hosts) {
    const files = new HostPlugin(host).planFiles('/repo');
    const generated = files.map(([, content]) => content).join('\n');
    const primary = files.find(([path]) => path.includes('agents-crew') && !path.includes('agents-crew-manager'))?.[1] ?? '';
    assert.ok(files.some(([path]) => path.includes('agents-crew')));
    assert.ok(files.some(([path, content]) => path.includes('reviewer') && content.includes('#')));
    assert.match(primary, /agents-crew orchestrate/u);
    assert.match(primary, /Do not ask the user to initialize Agents Crew/u);
    assert.match(primary, /dispatch_native/u);
    assert.match(primary, /crew manager submit --run <run_id> --action <action_id> --result <result-file>/u);
    assert.match(primary, /pending_approvals/u);
    assert.match(primary, /crew approve <approval_id> --run <run_id>/u);
    assert.match(primary, /If rejected.*report the blocked result, and stop/u);
    assert.match(primary, /do not automatically start or resume another run/u);
    assert.match(primary, /summarize returned `evidence` and `verification`/u);
    assert.match(primary, /invoke the original `agents-crew orchestrate/u);
    assert.match(generated, /crew agent/u);
    assert.doesNotMatch(generated, /You are the only installed manager/u);
  }
});

test('plugin doctor detects modifications and uninstall preserves them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-plugin-'));
  const plugin = new HostPlugin('claude-code');
  const installed = await plugin.install(root, false);
  const first = join(root, installed.files[0].path);
  await writeFile(first, `${await readFile(first, 'utf8')}\nuser edit\n`);
  const doctor = await plugin.doctor(root);
  assert.ok(doctor.files.some((file) => file.action === 'modified'));
  const removed = await plugin.uninstall(root);
  assert.ok(removed.files.some((file) => file.action === 'preserve'));
  assert.match(await readFile(first, 'utf8'), /user edit/);
});

test('plugin manifest cannot escape the workspace during uninstall', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'agents-crew-plugin-manifest-'));
  const root = join(sandbox, 'repo');
  await mkdir(join(root, '.agents-crew', 'plugin-manifests'), { recursive: true });
  const victim = join(sandbox, 'victim.txt');
  const content = 'keep me';
  await writeFile(victim, content);
  const digest = createHash('sha256').update(content).digest('hex');
  await writeFile(join(root, '.agents-crew', 'plugin-manifests', 'claude-code.json'), JSON.stringify({
    version: 1,
    host: 'claude-code',
    generated_by: 'agents-crew',
    files: [{ path: '../victim.txt', sha256: digest }],
  }));
  await assert.rejects(new HostPlugin('claude-code').uninstall(root), /invalid plugin manifest/i);
  assert.equal(await readFile(victim, 'utf8'), content);
});

test('plugin manifests reject wrong ownership, malformed hashes, and duplicate paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-plugin-invalid-manifest-'));
  const plugin = new HostPlugin('codex');
  await plugin.install(root);
  const manifestPath = join(root, '.agents-crew', 'plugin-manifests', 'codex.json');
  const valid = JSON.parse(await readFile(manifestPath, 'utf8'));
  const cases = [
    { ...valid, host: 'opencode' },
    { ...valid, generated_by: 'other-tool' },
    { ...valid, files: [{ ...valid.files[0], sha256: 'bad' }] },
    { ...valid, files: [valid.files[0], valid.files[0]] },
    { ...valid, files: 'not-an-array' },
  ];
  for (const value of cases) {
    await writeFile(manifestPath, JSON.stringify(value));
    await assert.rejects(plugin.doctor(root), /invalid plugin manifest/i);
  }
});
