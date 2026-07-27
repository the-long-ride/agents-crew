import test from 'node:test';
import assert from 'node:assert/strict';
import { isMainModule, runCli } from '../dist/cli.js';
import { detectTarget } from '../dist/platform.js';
import { pathToFileURL } from 'node:url';

function writer() {
  let value = '';
  return { write(chunk) { value += String(chunk); return true; }, get value() { return value; } };
}

function dependencies(overrides = {}) {
  const stdout = writer();
  const calls = [];
  return {
    stdout,
    calls,
    value: {
      env: {}, stdout, selectManager: async () => 'codex', confirmInstall: async () => true,
      detectTarget: () => detectTarget('linux', 'x64'), defaultInstallDir: () => '/tmp/bin',
      install: async (options) => {
        calls.push(options);
        return { version: options.version, repository: options.repository, asset: 'asset', checksum: 'a'.repeat(64),
          installDir: options.installDir, installed: [], manager: options.manager ?? null,
          workspace: options.binaryOnly ? null : options.workspace, pathConfigured: true };
      },
      ...overrides,
    },
  };
}

test('prints help without installing', async () => {
  const setup = dependencies();
  await runCli(['--help'], setup.value);
  assert.match(setup.stdout.value, /Usage:/);
  assert.equal(setup.calls.length, 0);
});

test('installs non-interactively from arguments and environment', async () => {
  const setup = dependencies({ env: { AGENTS_CREW_GITHUB_REPOSITORY: 'owner/repo' } });
  await runCli(['install', '--yes', '--manager', 'claude-code', '--version', '1.2.3'], setup.value);
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].repository, 'owner/repo');
  assert.equal(setup.calls[0].manager, 'claude-code');
  assert.match(setup.stdout.value, /Installed Agents Crew v1.2.3/);
  assert.match(setup.stdout.value, /Run: crew run/);
});

test('prompts for manager and supports cancellation', async () => {
  let selected = 0;
  const setup = dependencies({
    selectManager: async () => { selected += 1; return 'opencode'; },
    confirmInstall: async () => false,
  });
  await runCli(['install', '--repo', 'owner/repo', '--version', '1.2.3'], setup.value);
  assert.equal(selected, 1);
  assert.equal(setup.calls.length, 0);
  assert.equal(setup.stdout.value, 'Cancelled.\n');
});

test('requires a manager for --yes and prints PATH guidance when needed', async () => {
  const missing = dependencies();
  await assert.rejects(
    () => runCli(['install', '--yes', '--repo', 'owner/repo', '--version', '1.2.3'], missing.value),
    /--manager is required/,
  );

  const setup = dependencies({
    install: async (options) => ({ version: options.version, repository: options.repository, asset: 'asset', checksum: 'a'.repeat(64),
      installDir: options.installDir, installed: [], manager: null, workspace: null, pathConfigured: false }),
  });
  await runCli(['install', '--yes', '--binary-only', '--repo', 'owner/repo', '--version', '1.2.3'], setup.value);
  assert.match(setup.stdout.value, /Add \/tmp\/bin to PATH/);
});

test('detects direct CLI execution', () => {
  const path = process.argv[1];
  assert.equal(isMainModule(pathToFileURL(path).href, path), true);
  assert.equal(isMainModule('file:///different.js', path), false);
  assert.equal(isMainModule('file:///different.js', undefined), false);
});
