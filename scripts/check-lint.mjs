#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  [process.execPath, ['--test', 'crates/agents-crew-ui/web/app-model.test.mjs']],
  [process.execPath, ['scripts/verify-structure.mjs']],
  ['cargo', ['fmt', '--all', '--', '--check']],
  ['cargo', ['clippy', '--workspace', '--all-targets', '--all-features', '--', '-D', 'warnings']],
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'installer', 'run', 'lint']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('Repository lint checks passed.');
