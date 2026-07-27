import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTarget, releaseAssetName } from '../dist/platform.js';

test('maps supported Node platforms to Rust release targets', () => {
  assert.deepEqual(detectTarget('linux', 'x64'), { triple: 'x86_64-unknown-linux-gnu', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('linux', 'arm64'), { triple: 'aarch64-unknown-linux-gnu', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('darwin', 'arm64'), { triple: 'aarch64-apple-darwin', extension: 'tar.gz', windows: false });
  assert.deepEqual(detectTarget('win32', 'x64'), { triple: 'x86_64-pc-windows-msvc', extension: 'zip', windows: true });
});

test('rejects unsupported targets', () => {
  assert.throws(() => detectTarget('freebsd', 'x64'), /Unsupported platform/);
});

test('uses stable release asset naming', () => {
  const target = detectTarget('linux', 'x64');
  assert.equal(releaseAssetName('0.1.0', target), 'agents-crew-v0.1.0-x86_64-unknown-linux-gnu.tar.gz');
});
