import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseAssetUrl, releaseBaseUrl, validateRepository, validateVersion } from '../dist/release.js';

test('normalizes GitHub repository identifiers and URLs', () => {
  assert.equal(validateRepository(' owner/repo '), 'owner/repo');
  assert.equal(validateRepository('https://github.com/owner/repo.git'), 'owner/repo');
});

test('rejects malformed GitHub repositories', () => {
  for (const value of ['', 'owner', 'gitlab.com/owner/repo', 'owner/repo/extra']) {
    assert.throws(() => validateRepository(value), /Invalid GitHub repository/);
  }
});

test('accepts semantic versions and rejects unsafe values', () => {
  assert.equal(validateVersion(' v1.2.3-beta.1+build.2 '), '1.2.3-beta.1+build.2');
  for (const value of ['', 'latest', '../../latest', '1.2']) {
    assert.throws(() => validateVersion(value), /Invalid release version/);
  }
});

test('builds pinned and encoded GitHub Release URLs', () => {
  assert.equal(releaseBaseUrl('owner/repo', '1.2.3'), 'https://github.com/owner/repo/releases/download/v1.2.3');
  assert.equal(releaseAssetUrl('owner/repo', '1.2.3', 'asset name.tar.gz'), 'https://github.com/owner/repo/releases/download/v1.2.3/asset%20name.tar.gz');
});
