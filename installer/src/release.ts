export function validateRepository(repository: string): string {
  const value = repository.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Invalid GitHub repository: ${repository}. Expected owner/name.`);
  }
  return value;
}

export function validateVersion(version: string): string {
  const value = version.trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return value;
}

export function releaseBaseUrl(repository: string, version: string): string {
  return `https://github.com/${validateRepository(repository)}/releases/download/v${validateVersion(version)}`;
}

export function releaseAssetUrl(repository: string, version: string, asset: string): string {
  return `${releaseBaseUrl(repository, version)}/${encodeURIComponent(asset)}`;
}
