#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const THRESHOLD = parseFloat(process.env.COVERAGE_THRESHOLD || '85');
const repoRoot = path.resolve(__dirname, '..');

function sourceLineCount(relPath) {
  const ts = relPath.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
  const full = path.join(repoRoot, ts);
  if (!fs.existsSync(full)) return 0;
  return fs.readFileSync(full, 'utf8').split('\n').length;
}

function parseCoverageRows(output) {
  const lines = output.split(/\r?\n/);
  const pathStack = [];
  const rows = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[^\x00-\x7f]+/, '');
    if (!line.includes('|')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 5) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    const label = parts[0];
    if (label === '' || label === 'file' || label === 'all files') continue;
    const isData = /^\d+\.\d+$/.test(parts[1]) && /^\d+\.\d+$/.test(parts[2]) && /^\d+\.\d+$/.test(parts[3]);
    if (!isData) {
      pathStack[indent] = label;
      pathStack.length = indent + 1;
      continue;
    }
    const ancestor = pathStack.slice(0, indent).filter(Boolean).join('/');
    const relPath = ancestor ? `${ancestor}/${label}` : label;
    rows.push({
      path: relPath,
      linePct: parseFloat(parts[1]),
      branchPct: parseFloat(parts[2]),
      funcsPct: parseFloat(parts[3]),
    });
  }
  return rows;
}

function included(relPath) {
  if (!relPath.startsWith('dist/')) return false;
  if (relPath.endsWith('.cjs')) return false;
  if (relPath.includes('/packages/')) return false;
  if (relPath.endsWith('scripts/agent-bridge.cjs')) return false;
  return true;
}

const testArgs = fs
  .readdirSync(path.join(repoRoot, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => path.join('tests', f));

const result = spawnSync(process.execPath, [
  '--test',
  '--experimental-test-coverage',
  '--test-reporter=spec',
  ...testArgs,
], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status);

const rows = parseCoverageRows(result.stdout + '\n' + result.stderr);
const dist = rows.filter((r) => included(r.path));

if (dist.length === 0) {
  process.stderr.write('coverage-check: no dist/ rows parsed\n');
  process.exit(1);
}

dist.sort((a, b) => a.linePct - b.linePct);
let totalWeight = 0;
let weighted = 0;
process.stdout.write('\nagents-crew coverage (line %, weighted by source LOC, dist only):\n');
process.stdout.write('  file                                  line %  src LOC  weight\n');
process.stdout.write('  ------------------------------------- -------  -------  -------\n');
for (const r of dist) {
  const loc = sourceLineCount(r.path);
  totalWeight += loc;
  weighted += loc * r.linePct;
  const flag = r.linePct < 75 ? '!' : ' ';
  process.stdout.write(`${flag} ${r.path.padEnd(36)}  ${String(r.linePct).padStart(6)}  ${String(loc).padStart(7)}  ${String((loc * r.linePct).toFixed(0)).padStart(7)}\n`);
}
const aggregate = weighted / totalWeight;
process.stdout.write('\n');
process.stdout.write(`  Aggregate line coverage: ${aggregate.toFixed(2)}%  (target ${THRESHOLD}%)\n`);
process.stdout.write(`  Weighted across         ${dist.length} files, ${totalWeight} source lines\n\n`);

if (aggregate < THRESHOLD) {
  process.stderr.write(`coverage-check: FAIL — ${aggregate.toFixed(2)}% < ${THRESHOLD}% threshold.\n`);
  process.exit(1);
}
process.stdout.write(`coverage-check: PASS — ${aggregate.toFixed(2)}% >= ${THRESHOLD}%.\n`);
process.exit(0);
