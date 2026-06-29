#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'coverage'], { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
