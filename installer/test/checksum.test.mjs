import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseChecksumFile, verifyChecksum } from '../dist/checksum.js';

test('parses common SHA256SUMS formats', () => {
  const values = parseChecksumFile('abc123  file.tar.gz\ndef456 *file.zip\n');
  assert.equal(values.get('file.tar.gz'), 'abc123');
  assert.equal(values.get('file.zip'), 'def456');
});

test('verifies a downloaded file and rejects mismatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crew-checksum-'));
  const path = join(dir, 'asset');
  await writeFile(path, 'crew');
  await verifyChecksum(path, '9cae07a2e9ceea5b88602d99f1bb35f228663649628b7a3281ac9c8203e6043a');
  await assert.rejects(() => verifyChecksum(path, '0'.repeat(64)), /Checksum mismatch/);
});
