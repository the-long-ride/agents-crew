#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checkedRoots = ['src', 'scripts', 'test'];
const problems = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && ['.ts', '.mjs'].includes(extname(entry.name))) {
      const text = await readFile(path, 'utf8');
      const display = relative(root, path).replaceAll('\\', '/');
      if (/^\s*\/\/\s*@ts-nocheck/m.test(text)) problems.push(`${display}: remove @ts-nocheck`);
      if (!text.endsWith('\n')) problems.push(`${display}: missing final newline`);
      text.split(/\r?\n/).forEach((line, index) => {
        if (/\s+$/.test(line)) problems.push(`${display}:${index + 1}: trailing whitespace`);
      });
    }
  }
}

for (const directory of checkedRoots) await walk(join(root, directory));
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}

for (const file of ['scripts/write-build-metadata.mjs', 'scripts/lint.mjs', ...(
  await readdir(join(root, 'test'))
).filter((name) => name.endsWith('.mjs')).map((name) => `test/${name}`)]) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const typecheck = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});
if (typecheck.error) throw typecheck.error;
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);
console.log('Installer lint and type checks passed.');
