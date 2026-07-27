#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const requireFile = (path) => assert.ok(existsSync(join(root, path)), `missing ${path}`);
const readTree = (relativePath, suffix) => {
  const absoluteRoot = join(root, relativePath);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(absolutePath);
    }
  };
  visit(absoluteRoot);
  files.sort();
  return files.map((path) => readFileSync(path, 'utf8')).join('\n');
};

const rootCargo = read('Cargo.toml');
assert.match(rootCargo, /resolver\s*=\s*"3"/, 'workspace must use the Rust-version-aware dependency resolver');
assert.match(rootCargo, /rust-version\s*=\s*"1\.86"/, 'workspace MSRV must support resolved dependencies');
assert.match(rootCargo, /serde\s*=\s*\{\s*version\s*=\s*"=1\.0\.219"/, 'workspace must pin the Serde version tested by TOML 0.8.23');
assert.match(rootCargo, /toml\s*=\s*"=0\.8\.23"/, 'workspace must use the TOML release compatible with toml_edit 0.22.27');

const rustToolchain = read('rust-toolchain.toml');
assert.match(rustToolchain, /channel\s*=\s*"1\.86\.0"/, 'local Rust toolchain must pin Rust 1.86.0');
assert.match(rustToolchain, /"rustfmt"/, 'local Rust toolchain must include rustfmt');
assert.match(rustToolchain, /"clippy"/, 'local Rust toolchain must include clippy');

const cargo = read('crates/agents-crew-cli/Cargo.toml');
assert.match(cargo, /name\s*=\s*"crew"/, 'Cargo CLI must expose crew');
assert.match(cargo, /name\s*=\s*"agents-crew"/, 'Cargo CLI must retain agents-crew');
assert.match(cargo, /name\s*=\s*"crew"[\s\S]*?path\s*=\s*"src\/main\.rs"/, 'crew must use the primary entry point');
assert.match(cargo, /name\s*=\s*"agents-crew"[\s\S]*?path\s*=\s*"src\/bin\/agents-crew\.rs"/, 'compatibility binary must use a distinct entry point');

const cliLibrary = read('crates/agents-crew-cli/src/lib.rs');
assert.match(cliLibrary, /mod app;/, 'CLI library must own the app module');
assert.match(cliLibrary, /mod args;/, 'CLI library must own the argument module');
assert.match(cliLibrary, /mod output;/, 'CLI library must own the output module');
assert.match(cliLibrary, /pub async fn run_cli\(\)/, 'CLI library must expose the shared runner');

for (const binaryPath of [
  'crates/agents-crew-cli/src/main.rs',
  'crates/agents-crew-cli/src/bin/agents-crew.rs',
]) {
  const binary = read(binaryPath);
  assert.match(binary, /agents_crew_cli::run_cli\(\)/, `${binaryPath} must call the shared CLI runner`);
  assert.doesNotMatch(binary, /#\[path\s*=|mod\s+(?:app|args|output)\s*;/, `${binaryPath} must not duplicate source modules`);
}

const stateStore = read('crates/agents-crew-state/src/store.rs');
assert.doesNotMatch(stateStore, /\.map_or\(true,/, 'state-store optional checks must remain Clippy-clean');
assert.ok((stateStore.match(/\.is_none_or\(/g) ?? []).length >= 2, 'state store must use Option::is_none_or for both optional checks');

const app = readTree('crates/agents-crew-cli/src', '.rs');
assert.match(app, /"crew plugin install <host>"/);
assert.match(app, /"crew doctor"/);

const plugin = readTree('crates/agents-crew-plugins/src', '.rs');
assert.match(plugin, /`crew manager start/, 'generated commands must use crew');
assert.doesNotMatch(plugin, /`agents-crew (?:manager|run|plan|init|doctor|status|resume|pause|approve|reject|cancel|config)/, 'generated commands must not require compatibility name');

for (const path of [
  'crates/agents-crew-cli/src/lib.rs',
  'crates/agents-crew-cli/src/bin/agents-crew.rs',
  'installer/package.json',
  'installer/tsconfig.json',
  'installer/src/cli.ts',
  'installer/src/platform.ts',
  'installer/src/checksum.ts',
  'installer/src/archive.ts',
  'installer/src/install.ts',
  'installer/src/node-shims.d.ts',
  'installer/scripts/lint.mjs',
  'installer/test/cli.test.mjs',
  'installer/test/download.test.mjs',
  'installer/test/install.test.mjs',
  'installer/test/process.test.mjs',
  'installer/test/prompt.test.mjs',
  'installer/README.md',
  'installer/LICENSE',
  '.github/workflows/release.yml',
  'rust-toolchain.toml',
  'scripts/verify-structure.mjs',
  'scripts/check-lint.mjs',
  'scripts/check-coverage.mjs',
  'scripts/package-release.sh',
  'scripts/package-release.ps1',
  'docs/installation.md',
  'docs/releasing.md',
]) requireFile(path);

const packageJson = JSON.parse(read('installer/package.json'));
assert.equal(packageJson.type, 'module');
assert.notEqual(packageJson.private, true, 'installer package must be publishable');
assert.equal(packageJson.engines.node, '>=20.0.0');
assert.ok(packageJson.bin['agents-crew-install']);
assert.ok(packageJson.files.includes('dist'));
assert.ok(packageJson.files.includes('LICENSE'));
assert.equal(packageJson.publishConfig.provenance, true);
assert.equal(packageJson.publishConfig.access, 'public');
assert.equal(packageJson.publishConfig.registry, 'https://registry.npmjs.org/');
assert.equal(
  packageJson.scripts.lint,
  'npm run build:metadata && node ./scripts/lint.mjs',
  'lint must generate build metadata before type checking',
);
for (const script of ['lint', 'test', 'coverage', 'pack:check', 'check', 'prepack']) {
  assert.ok(packageJson.scripts[script], `installer package missing ${script} script`);
}
for (const threshold of ['--test-coverage-lines=85', '--test-coverage-functions=85', '--test-coverage-branches=85']) {
  assert.ok(packageJson.scripts.coverage.includes(threshold), `coverage script missing ${threshold}`);
}
const installerSources = readTree('installer/src', '.ts');
assert.doesNotMatch(installerSources, /^\s*\/\/\s*@ts-nocheck/m, 'installer sources must remain type checked');

const verifyStructure = read('scripts/verify-structure.mjs');
assert.doesNotMatch(
  verifyStructure,
  /missingReadmes|alternateFolderDocs|README\.md/,
  'structure verification must not require per-folder README files',
);

const release = read('.github/workflows/release.yml');
assert.match(release, /1\.86\.0/, 'release workflow must use the pinned supported Rust toolchain');
assert.doesNotMatch(release, /1\.(?:78|85)(?:\.[01])?/, 'release workflow must not use obsolete Rust toolchains');
for (const runner of ['ubuntu-latest', 'ubuntu-24.04-arm', 'macos-15-intel', 'macos-14', 'windows-latest']) {
  assert.ok(release.includes(runner), `release matrix missing ${runner}`);
}
for (const token of ['SHA256SUMS', 'gh release', 'npm publish', 'id-token: write', 'node-version: 24', 'npm run check', 'repository.url=git+https://github.com/${GITHUB_REPOSITORY}.git', 'AGENTS_CREW_GITHUB_REPOSITORY']) {
  assert.ok(release.includes(token), `release workflow missing ${token}`);
}
assert.doesNotMatch(release, /npm publish was skipped|Explain skipped npm publish/, 'npm publishing must fail rather than silently skip');
assert.match(release, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/, 'release keeps token fallback for the first publish');
assert.match(release, /NODE_AUTH_TOKEN: ''/, 'OIDC publish must clear token authentication');

const ci = read('.github/workflows/ci.yml');
assert.match(ci, /dtolnay\/rust-toolchain@1\.86\.0/, 'CI must use the pinned supported Rust toolchain');
assert.match(ci, /fail-fast:\s*false/, 'CI must run every operating-system matrix entry even when one fails');
for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
  assert.ok(ci.includes(runner), `CI Rust matrix missing ${runner}`);
}
assert.doesNotMatch(ci, /1\.(?:78|85)(?:\.[01])?/, 'CI must not use obsolete Rust toolchains');
assert.match(ci, /node-version: 24/);
assert.match(ci, /npm run check/);

const shellPackage = read('scripts/package-release.sh');
assert.match(shellPackage, /crew/);
assert.match(shellPackage, /agents-crew/);
const windowsPackage = read('scripts/package-release.ps1');
assert.match(windowsPackage, /crew\.exe/);
assert.match(windowsPackage, /agents-crew\.exe/);

const readme = read('README.md');
assert.match(readme, /npx @agents-crew\/installer install/);
assert.match(readme, /crew run/);

for (const markdownPath of ['README.md', 'GUIDELINE.md', 'docs/installation.md', 'docs/releasing.md']) {
  const content = read(markdownPath);
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const link = match[1].split('#')[0];
    if (!link || /^(?:https?:|mailto:)/.test(link)) continue;
    const target = resolve(root, dirname(markdownPath), link);
    assert.ok(existsSync(target), `${markdownPath} links to missing ${link}`);
  }
}

console.log('delivery static verification passed');
