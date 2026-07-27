import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTarget, executableName, releaseAssetName } from '../dist/platform.js';

test('maps every supported Node platform to a Rust release target', () => {
  assert.deepEqual(detectTarget('linux', 'x64'), { triple: 'x86_64-unknown-linux-gnu', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('linux', 'arm64'), { triple: 'aarch64-unknown-linux-gnu', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('darwin', 'x64'), { triple: 'x86_64-apple-darwin', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('darwin', 'arm64'), { triple: 'aarch64-apple-darwin', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('win32', 'x64'), { triple: 'x86_64-pc-windows-msvc', extension: 'zip', windows: true });
});

test('rejects unsupported targets', () => {
  assert.throws(() => detectTarget('freebsd', 'x64'), /Unsupported platform/);
});

test('builds stable asset and executable names', () => {
  const unix = detectTarget('linux', 'x64');
  const windows = detectTarget('win32', 'x64');
  assert.equal(releaseAssetName('v0.1.0', unix), 'agents-crew-v0.1.0-x86_64-unknown-linux-gnu.tar.gz');
  assert.equal(executableName('crew', unix), 'crew');
  assert.equal(executableName('agents-crew', windows), 'agents-crew.exe');
});
