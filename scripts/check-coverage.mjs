#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['--prefix', 'installer', 'run', 'coverage'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Installer coverage is above the required 85% thresholds.');
