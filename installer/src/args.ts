// @ts-nocheck
import { resolve } from 'node:path';

export const MANAGERS = ['codex', 'claude-code', 'opencode', 'antigravity'] as const;
export type ManagerHost = typeof MANAGERS[number];

export interface InstallerArgs {
  command: 'install' | 'help';
  manager?: ManagerHost;
  yes: boolean;
  binaryOnly: boolean;
  repository?: string;
  version?: string;
  installDir?: string;
  workspace: string;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): InstallerArgs {
  const input = [...argv];
  const commandToken = input[0] && !input[0].startsWith('-') ? input.shift() : 'install';
  if (commandToken === 'help' || input.includes('--help') || input.includes('-h')) {
    return { command: 'help', yes: false, binaryOnly: false, workspace: process.cwd() };
  }
  if (commandToken !== 'install') throw new Error(`Unknown command: ${commandToken}`);
  const result: InstallerArgs = { command: 'install', yes: false, binaryOnly: false, workspace: process.cwd() };
  for (let index = 0; index < input.length; index += 1) {
    const flag = input[index];
    if (flag === '--yes' || flag === '-y') result.yes = true;
    else if (flag === '--binary-only') result.binaryOnly = true;
    else if (flag === '--manager') {
      const manager = takeValue(input, index, flag);
      if (!MANAGERS.includes(manager)) throw new Error(`Unknown manager: ${manager}`);
      result.manager = manager;
      index += 1;
    } else if (flag === '--repo') { result.repository = takeValue(input, index, flag); index += 1; }
    else if (flag === '--version') { result.version = takeValue(input, index, flag).replace(/^v/, ''); index += 1; }
    else if (flag === '--install-dir') { result.installDir = resolve(takeValue(input, index, flag)); index += 1; }
    else if (flag === '--workspace') { result.workspace = resolve(takeValue(input, index, flag)); index += 1; }
    else throw new Error(`Unknown option: ${flag}`);
  }
  return result;
}
