#!/usr/bin/env node
// @ts-nocheck
import { parseArgs } from './args.js';
import { DEFAULT_GITHUB_REPOSITORY, INSTALLER_VERSION } from './generated.js';
import { install, defaultInstallDir } from './install.js';
import { detectTarget } from './platform.js';
import { selectManager, confirmInstall } from './prompt.js';
import { validateRepository, validateVersion } from './release.js';

const HELP = `Agents Crew installer\n\nUsage:\n  agents-crew-install install [options]\n\nOptions:\n  --manager <codex|claude-code|opencode|antigravity>\n  --repo <owner/repository>\n  --version <release version>\n  --install-dir <directory>\n  --workspace <repository directory>\n  --binary-only\n  --yes, -y\n  --help, -h\n`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') { process.stdout.write(HELP); return; }
  const repository = validateRepository(args.repository || process.env.AGENTS_CREW_GITHUB_REPOSITORY || DEFAULT_GITHUB_REPOSITORY);
  const version = validateVersion(args.version || INSTALLER_VERSION);
  const manager = args.binaryOnly ? undefined : (args.manager || (args.yes ? undefined : await selectManager()));
  if (!args.binaryOnly && !manager) throw new Error('--manager is required with --yes unless --binary-only is used');
  const target = detectTarget();
  const installDir = args.installDir || defaultInstallDir();
  const summary = `Install Agents Crew v${version}\n  Release: ${repository}\n  Target: ${target.triple}\n  Binary directory: ${installDir}${args.binaryOnly ? '' : `\n  Manager: ${manager}\n  Workspace: ${args.workspace}`}`;
  if (!args.yes && !(await confirmInstall(summary))) { process.stdout.write('Cancelled.\n'); return; }
  const result = await install({ ...args, repository, version, manager, target, installDir });
  process.stdout.write(`Installed Agents Crew v${result.version}.\n`);
  if (!result.pathConfigured) {
    process.stdout.write(`Add ${result.installDir} to PATH, then run: crew run \"your goal\"\n`);
  } else {
    process.stdout.write('Run: crew run "your goal"\n');
  }
}

main().catch((error) => {
  process.stderr.write(`agents-crew-install: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
