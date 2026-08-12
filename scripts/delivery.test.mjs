import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);


test('runtime implementation is grouped into source subdirectories', async () => {
  const entries = await readdir(new URL('../src/', import.meta.url), { withFileTypes: true });
  const allowed = new Set(['index.ts', 'node-shims.d.ts']);
  const flatModules = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(flatModules, []);
});



test('built UI contains Builder, Crews, Connect, Runtime, and History modules', async () => {
  const html = await readFile(new URL('../dist/ui/index.html', import.meta.url), 'utf-8');
  assert.match(html, />Builder</u);
  assert.match(html, />Crews</u);
  assert.match(html, />Connect</u);
  assert.match(html, />Runtime</u);
  assert.match(html, />History</u);
  assert.match(html, /id="fit-graph"/u);
  assert.match(html, /id="reset-zoom"/u);
  assert.match(html, /id="crew-name"/u);
  assert.match(html, /id="crew-id"/u);
  assert.match(html, /data-sidebar-resizer="left"/u);
  assert.match(html, /data-sidebar-resizer="right"/u);
  assert.match(html, /id="delete-crew"/u);
  assert.ok(html.indexOf('id="save-crew"') < html.indexOf('id="add-member"'), 'save must be left of add member');
  assert.match(html, /id="theme-toggle"/u);
  assert.match(html, /aria-label="Toggle between dark and light theme"/u);
  assert.match(html, /<select id="crew-group"/iu);
  assert.match(html, /class="scope-switch"/u);
  assert.match(html, /data-scope="global"/u);
  assert.match(html, /data-scope="workspace"/u);
  assert.match(html, /data-tooltip=/u);
  for (const asset of ['app.js', 'builder.js', 'templates.js', 'connect.js', 'processes.js', 'runtime.js', 'model.js', 'api.js', 'theme.js', 'components/combobox.js', 'components/info.js', 'components/tooltip.js', 'graph/viewport.js']) {
    const source = await readFile(new URL(`../dist/ui/assets/${asset}`, import.meta.url), 'utf8');
    assert.ok(source.length > 0, `empty UI asset ${asset}`);
  }
});
test('build output does not leak absolute source paths', async () => {
  const compiled = await readFile(new URL('../dist/domain/core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(compiled, /sourceMappingURL|file:\/\//u);
});

test('every nav data-view target has a matching view section and app view list', async () => {
  const html = await readFile(new URL('../dist/ui/index.html', import.meta.url), 'utf8');
  const navViews = [...html.matchAll(/data-view="([a-z]+)"/gu)].map((m) => m[1]);
  assert.ok(navViews.length > 0, 'no data-view nav buttons found');
  for (const view of navViews) {
    assert.match(html, new RegExp(`id="${view}-view"`, 'u'), `missing #${view}-view section for data-view="${view}"`);
  }
  const appSource = await readFile(new URL('../dist/ui/assets/app.js', import.meta.url), 'utf8');
  assert.match(
    appSource,
    /\[\s*'builder',\s*'crews',\s*'connect',\s*'runtime',\s*'history'\s*\]/u,
    'app.js must expose the same Builder/Crews/Connect/Runtime/History view list',
  );
});

test('typecheck fails instead of silently succeeding when no checker is available', () => {
  if (process.platform === 'win32') return;
  const result = spawnSync(process.execPath, ['scripts/typecheck.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /TypeScript compiler|tsc|npx/i);
});

test('repository uses pnpm for development while preserving npm installation', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const guideline = await readFile(new URL('../GUIDELINE.md', import.meta.url), 'utf8');
  assert.match(packageJson.packageManager, /^pnpm@(10|11)\./u);
  assert.match(ci, /pnpm install --frozen-lockfile/u);
  assert.match(ci, /pnpm run check/u);
  assert.match(guideline, /npm install --global @agents-crew\/cli/u);
  assert.match(guideline, /pnpm run build/u);
});

test('release publishes the exact verified npm artifact', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const publishJob = workflow.split(/^  npm-publish:/mu)[1] ?? '';
  assert.match(publishJob, /actions\/download-artifact@v6/u);
  assert.match(publishJob, /npm install --global [^\n]*npm@/u);
  assert.match(publishJob, /npm publish "\.\/\$PACKAGE"/u);
  assert.doesNotMatch(publishJob, /npm pkg set|npm publish --access public\s*$/mu);
});

test('manager action schema includes durable native workspace snapshots', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/manager-action.schema.json', import.meta.url), 'utf8'));
  const actionVariants = schema.$defs.action.oneOf;
  const native = actionVariants.find((item) => item.properties?.type?.const === 'dispatch_native');
  assert.ok(native);
  assert.ok(native.properties.workspace_snapshot);
});

test('manager decision schema describes task drafts instead of persisted tasks', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/manager-decision.schema.json', import.meta.url), 'utf8'));
  const taskDraft = schema.properties.tasks_to_add.items;
  assert.equal(taskDraft.type, 'object');
  assert.equal(taskDraft.required.includes('status'), false);
  assert.equal(taskDraft.required.includes('instructions'), true);
  assert.equal(taskDraft.properties.id === undefined || !taskDraft.required.includes('id'), true);
});
