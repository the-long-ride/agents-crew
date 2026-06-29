#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['run', 'typecheck'], ['run', 'lint']]) {
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
