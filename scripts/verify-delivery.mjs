#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const requireFile = (path) => assert.ok(existsSync(join(root, path)), `missing ${path}`);
const packageJson = JSON.parse(read('package.json'));

assert.equal(packageJson.name, '@agents-crew/cli');
assert.equal(packageJson.type, 'module');
assert.equal(packageJson.engines.node, '>=22.13.0');
assert.match(packageJson.packageManager, /^pnpm@10\./u);
assert.equal(packageJson.bin.crew, './dist/cli/entry.js');
assert.equal(packageJson.bin['agents-crew'], './dist/cli/entry.js');
assert.deepEqual(packageJson.dependencies ?? {}, {}, 'runtime dependencies are not allowed');
assert.deepEqual(packageJson.devDependencies ?? {}, {}, 'development dependencies are not allowed');
assert.ok(packageJson.files.includes('ui/src'), 'npm package must include browser TypeScript source');
assert.ok(packageJson.files.includes('ui/static'), 'npm package must include browser static source');
for (const script of ['build', 'typecheck', 'lint', 'test:unit', 'coverage', 'pack:check', 'check']) assert.ok(packageJson.scripts[script], `missing npm script ${script}`);
for (const path of ['pnpm-lock.yaml', 'src/cli/entry.ts', 'src/orchestration/engine.ts', 'src/orchestration/manager.ts', 'src/ui/server.ts', 'ui/static/index.html', 'roles/manager.md', 'schemas/worker-result.schema.json', '.github/workflows/ci.yml', '.github/workflows/release.yml']) requireFile(path);

const forbidden = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'dist', 'node_modules', '.agents-crew'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && (extname(path) === '.rs' || ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'].includes(entry.name))) forbidden.push(path);
  }
}
walk(root);
assert.deepEqual(forbidden, [], `Rust delivery files remain: ${forbidden.join(', ')}`);
assert.equal(existsSync(join(root, 'installer')), false, 'separate installer must be removed');

const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');
const manual = read('.github/workflows/manual-build.yml');
for (const [name, workflow] of [['ci', ci], ['release', release], ['manual-build', manual]]) {
  assert.match(workflow, /setup-node@v6/u, `${name} must configure Node`);
  assert.match(workflow, /pnpm\/action-setup@v6/u, `${name} must configure pnpm`);
  assert.doesNotMatch(workflow, /cargo|rustup|rust-toolchain/iu, `${name} must not use Rust`);
}
assert.match(release, /actions\/download-artifact@v4/u);
assert.match(release, /npm publish "\$PACKAGE" --access public --provenance/u);
assert.match(release, /npm pack/u);
assert.match(release, /id-token: write/u);
assert.match(ci, /pnpm install --frozen-lockfile/u);
assert.match(ci, /pnpm run check/u);
assert.match(read('README.md'), /pnpm run build\s*\n(?:```[\s\S]*?)?npm link/u);
assert.match(read('README.md'), /npm install --global @agents-crew\/cli/u);
console.log('TypeScript/pnpm development and npm delivery contract verified.');
