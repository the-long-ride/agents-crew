import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseAssetUrl, validateRepository, validateVersion } from '../dist/release.js';

test('normalizes GitHub repository URLs', () => {
  assert.equal(validateRepository('https://github.com/owner/repo.git'), 'owner/repo');
});

test('accepts semantic release versions and rejects path-like input', () => {
  assert.equal(validateVersion('v1.2.3'), '1.2.3');
  assert.throws(() => validateVersion('../../latest'), /Invalid release version/);
});

test('builds a pinned GitHub Release URL', () => {
  assert.equal(releaseAssetUrl('owner/repo', '1.2.3', 'asset.tar.gz'), 'https://github.com/owner/repo/releases/download/v1.2.3/asset.tar.gz');
});
