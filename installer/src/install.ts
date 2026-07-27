// @ts-nocheck
import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { extractArchive } from './archive.js';
import { parseChecksumFile, verifyChecksum } from './checksum.js';
import { downloadFile, downloadText } from './download.js';
import { executableName, releaseAssetName } from './platform.js';
import { releaseAssetUrl } from './release.js';
import { runCommand } from './process.js';

export function defaultInstallDir(): string {
  return resolve(process.env.AGENTS_CREW_INSTALL_DIR || join(homedir(), '.agents-crew', 'bin'));
}

async function atomicCopy(source: string, destination: string, executable: boolean): Promise<void> {
  const temporary = `${destination}.new-${process.pid}`;
  await copyFile(source, temporary);
  if (executable && process.platform !== 'win32') await chmod(temporary, 0o755);
  await rm(destination, { force: true });
  await rename(temporary, destination);
}

function pathContains(directory: string): boolean {
  return (process.env.PATH || '').split(delimiter).some((entry) => resolve(entry) === resolve(directory));
}

export async function install(options): Promise<object> {
  const target = options.target;
  const asset = releaseAssetName(options.version, target);
  const baseUrl = releaseAssetUrl(options.repository, options.version, asset);
  const checksumUrl = releaseAssetUrl(options.repository, options.version, 'SHA256SUMS');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agents-crew-install-'));
  const archivePath = join(temporaryRoot, asset);
  const extracted = join(temporaryRoot, 'extracted');
  const installDir = resolve(options.installDir || defaultInstallDir());
  try {
    await downloadFile(baseUrl, archivePath);
    const checksums = parseChecksumFile(await downloadText(checksumUrl));
    const expected = checksums.get(asset);
    if (!expected) throw new Error(`SHA256SUMS does not contain ${asset}`);
    await verifyChecksum(archivePath, expected);
    await extractArchive(archivePath, extracted);
    await mkdir(installDir, { recursive: true });
    const installed = [];
    for (const name of ['crew', 'agents-crew']) {
      const executable = executableName(name, target);
      const source = join(extracted, executable);
      const sourceStat = await lstat(source).catch(() => { throw new Error(`Release archive is missing ${executable}`); });
      if (!sourceStat.isFile()) throw new Error(`Release archive entry is not a regular file: ${executable}`);
      const destination = join(installDir, executable);
      await atomicCopy(source, destination, true);
      installed.push(destination);
    }
    const crewPath = join(installDir, executableName('crew', target));
    if (!options.binaryOnly) {
      await runCommand(crewPath, ['--workspace', options.workspace, '--json', 'init', '--non-interactive'], { cwd: options.workspace, quiet: true });
      await runCommand(crewPath, ['--workspace', options.workspace, '--json', 'plugin', 'install', options.manager], { cwd: options.workspace, quiet: true });
      await runCommand(crewPath, ['--workspace', options.workspace, '--json', 'plugin', 'doctor', options.manager], { cwd: options.workspace, quiet: true });
    }
    return {
      version: options.version,
      repository: options.repository,
      asset,
      checksum: expected,
      installDir,
      installed,
      manager: options.binaryOnly ? null : options.manager,
      workspace: options.binaryOnly ? null : options.workspace,
      pathConfigured: pathContains(installDir),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
