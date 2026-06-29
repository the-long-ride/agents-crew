import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, saveConfig, starterConfig, validateConfig } from '../dist/config/config.js';

test('config TOML round trip preserves worker arrays and verification commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-config-'));
  const path = join(root, 'config.toml');
  const config = starterConfig();
  config.verification.commands = [['npm', 'test']];
  config.workers.push({
    id: 'local-reviewer', kind: 'cli', enabled: true, adapter: 'opencode', model: 'configured-by-user',
    roles: ['reviewer'], capabilities: ['read', 'shell'], priority: 50, args: [], env_allowlist: [], headers: {},
  });
  await saveConfig(path, config);
  const text = await readFile(path, 'utf8');
  assert.match(text, /\[\[workers\]\]/);
  const loaded = await loadConfig(path);
  assert.deepEqual(loaded.verification.commands, [['npm', 'test']]);
  assert.equal(loaded.workers.at(-1).id, 'local-reviewer');
});

test('config rejects writable API workers and duplicate ids', () => {
  const config = starterConfig();
  config.workers.push({ ...config.workers[0] });
  assert.throws(() => validateConfig(config), /duplicate worker id/i);
  const api = starterConfig();
  api.workers = [{
    id: 'api', kind: 'api', enabled: true, provider: 'openai-compatible', model: 'm', api_key_env: 'KEY',
    roles: ['researcher'], capabilities: ['read', 'write'], priority: 1, args: [], env_allowlist: [], headers: {},
  }];
  assert.throws(() => validateConfig(api), /cannot write/i);
});

test('config validation reports malformed top-level and worker fields', () => {
  const cases = [
    [config => { config.version = 2; }, /version must be 1/],
    [config => { config.template = { id: '', name: 'x', description: '', layout: {} }; }, /template id/],
    [config => { config.run.max_iterations = 0; }, /positive integer/],
    [config => { config.run.workspace_mode = 'bad'; }, /workspace_mode/],
    [config => { config.manager.coding = 'bad'; }, /manager coding/],
    [config => { config.permissions.network = 'bad'; }, /invalid permission/],
    [config => { config.workers[0].id = ''; }, /must not be empty/],
    [config => { config.workers[0].roles = []; }, /has no roles/],
    [config => { config.workers[0].roles = ['bad']; }, /invalid role/],
    [config => { config.workers[0].capabilities = ['bad']; }, /invalid capability/],
    [config => { config.workers[0] = { ...config.workers[0], kind: 'cli', adapter: undefined, command: undefined }; }, /needs adapter or command/],
    [config => { config.workers[0] = { ...config.workers[0], kind: 'api', provider: undefined, model: undefined, api_key_env: undefined, capabilities: ['read'] }; }, /needs provider/],
    [config => { config.workers[0].api_key_env = 'bad-key'; }, /invalid api key/],
    [config => { config.workers[0].timeout_seconds = 0; }, /positive integer/],
    [config => { config.workers[0].enabled = false; }, /at least one worker/],
  ];
  for (const [mutate, expected] of cases) {
    const config = starterConfig();
    mutate(config);
    assert.throws(() => validateConfig(config), expected);
  }
});

test('loading older minimal TOML fills optional defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-old-config-'));
  const path = join(root, 'config.toml');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(path, `version = 1\n\n[run]\nworkspace_mode = "current"\nmax_iterations = 1\nmax_parallel_readers = 1\nmax_parallel_writers = 1\nmax_tasks_per_iteration = 1\ndefault_task_timeout_seconds = 1\n\n[manager]\nhost = "test"\ncoding = "never"\nsmall_fix_max_files = 1\nsmall_fix_max_changed_lines = 1\n\n[autonomy]\nmode = "safe"\n\n[permissions]\nlocal_read = "allow"\nlocal_edit = "deny"\ntest_commands = "allow"\nnetwork = "deny"\ndestructive_commands = "deny"\ncredentialed_actions = "deny"\ncommit = "deny"\npush = "deny"\ndeploy = "deny"\n\n[verification]\n\n[[workers]]\nid = "native"\nkind = "native"\nenabled = true\nroles = ["researcher"]\ncapabilities = ["read"]\npriority = 1\nargs = []\nenv_allowlist = []\n\n[workers.headers]\n`, 'utf8'));
  const loaded = await loadConfig(path);
  assert.equal(loaded.run.retain_failed_worktrees, false);
  assert.deepEqual(loaded.verification.commands, []);
  assert.equal(loaded.workers[0].requires_network, undefined);
});

test('config rejects unsafe worker ids and non-HTTP API endpoints', () => {
  const unsafe = starterConfig();
  unsafe.workers[0].id = '../worker';
  assert.throws(() => validateConfig(unsafe), /worker id/i);

  const api = starterConfig();
  api.workers = [{
    id: 'api-safe', kind: 'api', enabled: true, provider: 'openai', model: 'm', api_key_env: 'KEY', api_base_url: 'file:///tmp/secret',
    roles: ['researcher'], capabilities: ['read'], priority: 1, args: [], env_allowlist: [], headers: {},
  }];
  assert.throws(() => validateConfig(api), /http/i);
});
