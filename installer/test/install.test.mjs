import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultInstallDir, install } from '../dist/install.js';
import { detectTarget, executableName, releaseAssetName } from '../dist/platform.js';

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'crew-install-test-'));
  const installDir = join(root, 'bin');
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const target = detectTarget(process.platform === 'win32' ? 'win32' : 'linux', 'x64');
  const asset = releaseAssetName('1.2.3', target);
  const commands = [];
  const dependencies = {
    downloadFile: async (_url, destination) => writeFile(destination, 'archive'),
    downloadText: async () => `${'a'.repeat(64)}  ${asset}\n`,
    verifyChecksum: async (path, expected) => {
      assert.equal(await readFile(path, 'utf8'), 'archive');
      assert.equal(expected, 'a'.repeat(64));
    },
    extractArchive: async (_archive, destination) => {
      await mkdir(destination, { recursive: true });
      for (const name of ['crew', 'agents-crew']) {
        await writeFile(join(destination, executableName(name, target)), name);
      }
    },
    runCommand: async (command, args, options) => {
      commands.push({ command, args, options });
      return { stdout: '', stderr: '', code: 0 };
    },
    ...overrides,
  };
  return { root, installDir, workspace, target, asset, commands, dependencies };
}

test('installs both binaries, configures a manager, and reports PATH state', async () => {
  const setup = await fixture();
  const oldPath = process.env.PATH;
  process.env.PATH = [setup.installDir, oldPath].filter(Boolean).join(delimiter);
  try {
    const result = await install({
      repository: 'owner/repo', version: '1.2.3', manager: 'codex', binaryOnly: false,
      workspace: setup.workspace, installDir: setup.installDir, target: setup.target,
    }, setup.dependencies);
    assert.equal(result.asset, setup.asset);
    assert.equal(result.manager, 'codex');
    assert.equal(result.pathConfigured, true);
    assert.equal(result.installed.length, 2);
    assert.equal(setup.commands.length, 3);
    assert.deepEqual(setup.commands.map((call) => call.args.slice(-3)), [
      ['--json', 'init', '--non-interactive'], ['plugin', 'install', 'codex'], ['plugin', 'doctor', 'codex'],
    ]);
    for (const path of result.installed) await access(path);
  } finally {
    process.env.PATH = oldPath;
  }
});

test('supports binary-only installs and skips manager commands', async () => {
  const setup = await fixture();
  const result = await install({
    repository: 'owner/repo', version: '1.2.3', binaryOnly: true,
    workspace: setup.workspace, installDir: setup.installDir, target: setup.target,
  }, setup.dependencies);
  assert.equal(result.manager, null);
  assert.equal(result.workspace, null);
  assert.equal(result.pathConfigured, false);
  assert.equal(setup.commands.length, 0);
});

test('rejects missing checksums and invalid extracted entries while cleaning temporary files', async () => {
  const missing = await fixture({ downloadText: async () => '' });
  await assert.rejects(() => install({
    repository: 'owner/repo', version: '1.2.3', binaryOnly: true,
    workspace: missing.workspace, installDir: missing.installDir, target: missing.target,
  }, missing.dependencies), /does not contain/);

  const target = detectTarget(process.platform === 'win32' ? 'win32' : 'linux', 'x64');
  const invalid = await fixture({
    extractArchive: async (_archive, destination) => {
      await mkdir(destination, { recursive: true });
      await mkdir(join(destination, executableName('crew', target)), { recursive: true });
    },
  });
  await assert.rejects(() => install({
    repository: 'owner/repo', version: '1.2.3', binaryOnly: true,
    workspace: invalid.workspace, installDir: invalid.installDir, target: invalid.target,
  }, invalid.dependencies), /not a regular file|missing/);
});

test('uses environment override for the default install directory', () => {
  const oldValue = process.env.AGENTS_CREW_INSTALL_DIR;
  process.env.AGENTS_CREW_INSTALL_DIR = './custom-bin';
  try {
    assert.equal(defaultInstallDir(), join(process.cwd(), 'custom-bin'));
  } finally {
    if (oldValue === undefined) delete process.env.AGENTS_CREW_INSTALL_DIR;
    else process.env.AGENTS_CREW_INSTALL_DIR = oldValue;
  }
});
