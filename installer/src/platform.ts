// @ts-nocheck
export interface ReleaseTarget {
  triple: string;
  extension: 'tar.gz' | 'zip';
  windows: boolean;
}

const TARGETS = new Map([
  ['linux:x64', { triple: 'x86_64-unknown-linux-gnu', extension: 'tar.gz', windows: false }],
  ['linux:arm64', { triple: 'aarch64-unknown-linux-gnu', extension: 'tar.gz', windows: false }],
  ['darwin:x64', { triple: 'x86_64-apple-darwin', extension: 'tar.gz', windows: false }],
  ['darwin:arm64', { triple: 'aarch64-apple-darwin', extension: 'tar.gz', windows: false }],
  ['win32:x64', { triple: 'x86_64-pc-windows-msvc', extension: 'zip', windows: true }],
]);

export function detectTarget(platform = process.platform, arch = process.arch): ReleaseTarget {
  const target = TARGETS.get(`${platform}:${arch}`);
  if (!target) {
    throw new Error(`Unsupported platform: ${platform}/${arch}. Build the Rust binary from source or pass a supported machine.`);
  }
  return { ...target };
}

export function releaseAssetName(version: string, target: ReleaseTarget): string {
  const cleanVersion = version.replace(/^v/, '');
  return `agents-crew-v${cleanVersion}-${target.triple}.${target.extension}`;
}

export function executableName(base: 'crew' | 'agents-crew', target: ReleaseTarget): string {
  return target.windows ? `${base}.exe` : base;
}
