import { chmod, copyFile, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { extractArchive } from './archive.js';
import { parseChecksumFile, verifyChecksum } from './checksum.js';
import { downloadFile, downloadText } from './download.js';
import { executableName, releaseAssetName, type ReleaseTarget } from './platform.js';
import { runCommand } from './process.js';
import { releaseAssetUrl } from './release.js';
import type { ManagerHost } from './args.js';

export interface InstallOptions {
  repository: string;
  version: string;
  manager?: ManagerHost;
  binaryOnly: boolean;
  workspace: string;
  installDir?: string;
  target: ReleaseTarget;
}

export interface InstallResult {
  version: string;
  repository: string;
  asset: string;
  checksum: string;
  installDir: string;
  installed: string[];
  manager: ManagerHost | null;
  workspace: string | null;
  pathConfigured: boolean;
}

export interface InstallDependencies {
  downloadFile: typeof downloadFile;
  downloadText: typeof downloadText;
  verifyChecksum: typeof verifyChecksum;
  extractArchive: typeof extractArchive;
  runCommand: typeof runCommand;
}

const DEFAULT_DEPENDENCIES: InstallDependencies = {
  downloadFile,
  downloadText,
  verifyChecksum,
  extractArchive,
  runCommand,
};

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
  return (process.env.PATH || '')
    .split(delimiter)
    .some((entry) => resolve(entry) === resolve(directory));
}

export async function install(
  options: InstallOptions,
  dependencyOverrides: Partial<InstallDependencies> = {},
): Promise<InstallResult> {
  if (!options.binaryOnly && !options.manager) {
    throw new Error('A manager is required unless binary-only installation is selected');
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const target = options.target;
  const asset = releaseAssetName(options.version, target);
  const baseUrl = releaseAssetUrl(options.repository, options.version, asset);
  const checksumUrl = releaseAssetUrl(options.repository, options.version, 'SHA256SUMS');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agents-crew-install-'));
  const archivePath = join(temporaryRoot, asset);
  const extracted = join(temporaryRoot, 'extracted');
  const installDir = resolve(options.installDir || defaultInstallDir());
  try {
    await dependencies.downloadFile(baseUrl, archivePath);
    const checksums = parseChecksumFile(await dependencies.downloadText(checksumUrl));
    const expected = checksums.get(asset);
    if (!expected) throw new Error(`SHA256SUMS does not contain ${asset}`);
    await dependencies.verifyChecksum(archivePath, expected);
    await dependencies.extractArchive(archivePath, extracted);
    await mkdir(installDir, { recursive: true });

    const installed: string[] = [];
    for (const name of ['crew', 'agents-crew'] as const) {
      const executable = executableName(name, target);
      const source = join(extracted, executable);
      const sourceStat = await lstat(source).catch(() => {
        throw new Error(`Release archive is missing ${executable}`);
      });
      if (!sourceStat.isFile()) {
        throw new Error(`Release archive entry is not a regular file: ${executable}`);
      }
      const destination = join(installDir, executable);
      await atomicCopy(source, destination, true);
      installed.push(destination);
    }

    const crewPath = join(installDir, executableName('crew', target));
    if (!options.binaryOnly) {
      const manager = options.manager as ManagerHost;
      const commandOptions = { cwd: options.workspace, quiet: true };
      await dependencies.runCommand(
        crewPath,
        ['--workspace', options.workspace, '--json', 'init', '--non-interactive'],
        commandOptions,
      );
      await dependencies.runCommand(
        crewPath,
        ['--workspace', options.workspace, '--json', 'plugin', 'install', manager],
        commandOptions,
      );
      await dependencies.runCommand(
        crewPath,
        ['--workspace', options.workspace, '--json', 'plugin', 'doctor', manager],
        commandOptions,
      );
    }

    return {
      version: options.version,
      repository: options.repository,
      asset,
      checksum: expected,
      installDir,
      installed,
      manager: options.binaryOnly ? null : options.manager as ManagerHost,
      workspace: options.binaryOnly ? null : options.workspace,
      pathConfigured: pathContains(installDir),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
