import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFile, downloadText } from '../dist/download.js';

const response = (body, options = {}) => new Response(body, { status: options.status ?? 200 });

test('downloads text with the installer user-agent', async () => {
  let request;
  const text = await downloadText('https://example.test/SHA256SUMS', async (url, options) => {
    request = { url, options };
    return response('checksum');
  });
  assert.equal(text, 'checksum');
  assert.equal(request.url, 'https://example.test/SHA256SUMS');
  assert.equal(request.options.redirect, 'follow');
  assert.equal(request.options.headers['user-agent'], 'agents-crew-installer');
});

test('downloads a file with restrictive permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crew-download-'));
  const destination = join(root, 'asset');
  await downloadFile('https://example.test/asset', destination, async () => response('payload'));
  assert.equal(await readFile(destination, 'utf8'), 'payload');
  if (process.platform !== 'win32') assert.equal((await stat(destination)).mode & 0o777, 0o600);
});

test('rejects failed and bodyless downloads', async () => {
  await assert.rejects(() => downloadText('https://example.test/missing', async () => response('missing', { status: 404 })), /Download failed \(404\)/);
  await assert.rejects(() => downloadFile('https://example.test/empty', '/tmp/unused', async () => ({ ok: true, status: 200, body: null })), /Download failed \(200\)/);
});
