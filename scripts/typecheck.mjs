import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = ['--noEmit', '-p', 'tsconfig.json'];
const useShell = process.platform === 'win32';
const tsc = useShell ? 'tsc' : 'tsc';
let result = spawnSync(tsc, args, { stdio: 'inherit', shell: useShell });
if (result.status === 0) process.exit(0);

const npx = useShell ? 'npx' : 'npx';
console.error('Global TypeScript compiler not found; trying pinned TypeScript 5.9.3 through npx.');
result = spawnSync(npx, ['--yes', '--package', 'typescript@5.9.3', 'tsc', ...args], { stdio: 'inherit', shell: useShell });
if (result.status !== 0) {
  console.error('TypeScript compiler unavailable: install tsc or ensure npx is on PATH.');
  process.exit(1);
}
process.exit(0);
