import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = ['--noEmit', '-p', 'tsconfig.json'];
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
let result = spawnSync(tsc, args, { stdio: 'inherit', shell: false });
if (!result.error || result.error.code !== 'ENOENT') process.exit(result.status ?? 1);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
console.error('Global TypeScript compiler not found; trying pinned TypeScript 5.9.3 through npx.');
result = spawnSync(npx, ['--yes', '--package', 'typescript@5.9.3', 'tsc', ...args], { stdio: 'inherit', shell: false });
if (result.error?.code === 'ENOENT') {
  console.error('TypeScript compiler unavailable: install tsc or ensure npx is on PATH.');
  process.exit(1);
}
process.exit(result.status ?? 1);
