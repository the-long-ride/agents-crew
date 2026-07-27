#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { parseArgs } from './args.js';
import { DEFAULT_GITHUB_REPOSITORY, INSTALLER_VERSION } from './generated.js';
import { defaultInstallDir, install, type InstallResult } from './install.js';
import { detectTarget } from './platform.js';
import { confirmInstall, selectManager } from './prompt.js';
import { validateRepository, validateVersion } from './release.js';

const HELP = `Agents Crew installer\n\nUsage:\n  agents-crew-install install [options]\n\nOptions:\n  --manager <codex|claude-code|opencode|antigravity>\n  --repo <owner/repository>\n  --version <release version>\n  --install-dir <directory>\n  --workspace <repository directory>\n  --binary-only\n  --yes, -y\n  --help, -h\n`;

interface WritableOutput {
  write(value: string): unknown;
}

export interface CliDependencies {
  env: Record<string, string | undefined>;
  stdout: WritableOutput;
  selectManager: typeof selectManager;
  confirmInstall: typeof confirmInstall;
  detectTarget: typeof detectTarget;
  defaultInstallDir: typeof defaultInstallDir;
  install: typeof install;
}

const DEFAULT_DEPENDENCIES: CliDependencies = {
  env: process.env,
  stdout: process.stdout,
  selectManager,
  confirmInstall,
  detectTarget,
  defaultInstallDir,
  install,
};

export async function runCli(
  argv: string[],
  dependencyOverrides: Partial<CliDependencies> = {},
): Promise<InstallResult | undefined> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const args = parseArgs(argv);
  if (args.command === 'help') {
    dependencies.stdout.write(HELP);
    return undefined;
  }

  const repository = validateRepository(
    args.repository
      || dependencies.env.AGENTS_CREW_GITHUB_REPOSITORY
      || DEFAULT_GITHUB_REPOSITORY,
  );
  const version = validateVersion(args.version || INSTALLER_VERSION);
  const manager = args.binaryOnly
    ? undefined
    : args.manager || (args.yes ? undefined : await dependencies.selectManager());
  if (!args.binaryOnly && !manager) {
    throw new Error('--manager is required with --yes unless --binary-only is used');
  }

  const target = dependencies.detectTarget();
  const installDir = args.installDir || dependencies.defaultInstallDir();
  const summary = `Install Agents Crew v${version}\n  Release: ${repository}\n  Target: ${target.triple}\n  Binary directory: ${installDir}${args.binaryOnly ? '' : `\n  Manager: ${manager}\n  Workspace: ${args.workspace}`}`;
  if (!args.yes && !(await dependencies.confirmInstall(summary))) {
    dependencies.stdout.write('Cancelled.\n');
    return undefined;
  }

  const result = await dependencies.install({
    repository,
    version,
    manager,
    binaryOnly: args.binaryOnly,
    workspace: args.workspace,
    installDir,
    target,
  });
  dependencies.stdout.write(`Installed Agents Crew v${result.version}.\n`);
  if (!result.pathConfigured) {
    dependencies.stdout.write(`Add ${result.installDir} to PATH, then run: crew run "your goal"\n`);
  } else {
    dependencies.stdout.write('Run: crew run "your goal"\n');
  }
  return result;
}

export function isMainModule(moduleUrl: string, executablePath: string | undefined): boolean {
  return executablePath !== undefined && pathToFileURL(executablePath).href === moduleUrl;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agents-crew-install: ${message}\n`);
    process.exitCode = 1;
  });
}
