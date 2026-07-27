import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChecksumFile, sha256File, verifyChecksum } from '../dist/checksum.js';

test('parses common SHA256SUMS formats, blank lines, and uppercase hashes', () => {
  const values = parseChecksumFile('\nABC123  file.tar.gz\ndef456 *file.zip\n');
  assert.equal(values.get('file.tar.gz'), 'abc123');
  assert.equal(values.get('file.zip'), 'def456');
});

test('rejects malformed checksum records', () => {
  assert.throws(() => parseChecksumFile('not-a-checksum'), /Invalid checksum line/);
});

test('hashes and verifies files while rejecting invalid or mismatched values', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crew-checksum-'));
  const path = join(dir, 'asset');
  await writeFile(path, 'crew');
  const expected = '9cae07a2e9ceea5b88602d99f1bb35f228663649628b7a3281ac9c8203e6043a';
  assert.equal(await sha256File(path), expected);
  await verifyChecksum(path, expected.toUpperCase());
  await assert.rejects(() => verifyChecksum(path, 'short'), /SHA-256/);
  await assert.rejects(() => verifyChecksum(path, '0'.repeat(64)), /Checksum mismatch/);
});
