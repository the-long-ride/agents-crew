import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

async function walk(path) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child));
    else output.push(child);
  }
  return output;
}

const files = await walk('.');
assert.equal(files.some((file) => extname(file) === '.rs'), false, 'Rust source must be removed');
assert.equal(files.some((file) => file.endsWith('Cargo.toml') || file.endsWith('Cargo.lock')), false, 'Cargo files must be removed');
for (const file of files.filter((item) => item.endsWith('.ts'))) {
  const content = await readFile(file, 'utf8');
  assert.doesNotMatch(content, /^\s*\/\/\s*@ts-nocheck/m, `${file} disables type checking`);
}
console.log('Static repository checks passed.');
