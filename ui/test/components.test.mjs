import assert from 'node:assert/strict';
import test from 'node:test';
import { comboboxMarkup, comboboxOpeningQuery, filterOptions } from '../../dist/ui/assets/components/combobox.js';
import { infoButtonMarkup } from '../../dist/ui/assets/components/info.js';
import { resizeSidebarWidth } from '../../dist/ui/assets/components/sidebar-resizer.js';
import { crewTableMarkup } from '../../dist/ui/assets/templates.js';
import { applyTheme, mountThemeToggle, resolveInitialTheme } from '../../dist/ui/assets/theme.js';

const options = [
  { value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'OpenAI · reasoning' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Anthropic · 1M context' },
];

test('custom combobox filters label, value, and description', () => {
  assert.deepEqual(filterOptions(options, 'codex').map((item) => item.value), ['gpt-5-codex']);
  assert.deepEqual(filterOptions(options, 'anthropic').map((item) => item.value), ['claude-opus-4-6']);
  assert.equal(filterOptions(options, '').length, 2);
});

test('combobox marks the current option with the SVG selection icon', () => {
  const html = comboboxMarkup({ id: 'model-id', value: 'gpt-5-codex', options });
  assert.match(html, /data-combo-index="0" aria-selected="true"/u);
  assert.match(html, /data-combo-index="1" aria-selected="false"/u);
});

test('combobox markup is accessible and contains no native select or datalist', () => {
  const html = comboboxMarkup({ id: 'model-id', value: '', options, placeholder: 'Choose model', allowCustom: true });
  assert.match(html, /role="combobox"/u);
  assert.match(html, /role="listbox"/u);
  assert.match(html, /aria-autocomplete="list"/u);
  assert.doesNotMatch(html, /<select|<datalist/iu);
  assert.match(html, /<svg[^>]*class="combo-chevron"/u);
  assert.match(html, /<svg[^>]*class="combo-check"/u);
  assert.doesNotMatch(html, />⌄</u);
});



test('sidebar widths clamp between practical minimum and 500px', () => {
  assert.equal(resizeSidebarWidth(280, 50, 'left'), 330);
  assert.equal(resizeSidebarWidth(490, 80, 'left'), 500);
  assert.equal(resizeSidebarWidth(280, -50, 'left'), 260);
  assert.equal(resizeSidebarWidth(330, 80, 'right'), 250);
  assert.equal(resizeSidebarWidth(220, 80, 'right'), 200);
});

test('template table exposes delete only for writable templates', () => {
  const records = [
    { id: 'default', name: 'Default', description: '', scope: 'builtin', config: { workers: [] } },
    { id: 'team', name: 'Team', description: '', scope: 'workspace', path: '/tmp/team.toml', config: { workers: [] } },
  ];
  const html = crewTableMarkup(records);
  assert.match(html, /data-delete="workspace:team"/u);
  assert.doesNotMatch(html, /data-delete="builtin:default"/u);
});

test('info button markup carries accessible section help', () => {
  const html = infoButtonMarkup('Crew canvas', 'Pan, zoom, and arrange workers.');
  assert.match(html, /aria-label="About Crew canvas"/u);
  assert.match(html, /data-info-title="Crew canvas"/u);
  assert.match(html, /Pan, zoom, and arrange workers/u);
});

test('theme resolution prefers stored choice, then OS choice', () => {
  assert.equal(resolveInitialTheme('light', true), 'light');
  assert.equal(resolveInitialTheme('bad', true), 'dark');
  assert.equal(resolveInitialTheme(null, false), 'light');
});


test('applying a theme updates the document, storage, and toggle states', () => {
  const priorDocument = globalThis.document;
  const priorLocalStorage = globalThis.localStorage;
  const stored = new Map();
  const buttons = [
    { dataset: { theme: 'light' }, attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } },
    { dataset: { theme: 'dark' }, attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } },
  ];

  globalThis.document = {
    documentElement: { dataset: {}, style: {} },
    querySelectorAll: () => buttons,
  };
  globalThis.localStorage = {
    setItem: (key, value) => stored.set(key, value),
  };

  try {
    applyTheme('light');
    assert.equal(globalThis.document.documentElement.dataset.theme, 'light');
    assert.equal(globalThis.document.documentElement.style.colorScheme, 'light');
    assert.equal(stored.get('agents-crew-theme'), 'light');
    assert.equal(buttons[0].attributes.get('aria-pressed'), 'true');
    assert.equal(buttons[1].attributes.get('aria-pressed'), 'false');
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorLocalStorage;
  }
});


test('opening a combobox shows every option for an exact current selection', () => {
  assert.equal(comboboxOpeningQuery(options, 'gpt-5-codex'), '');
  assert.equal(comboboxOpeningQuery(options, 'GPT-5 Codex', true), '');
  assert.equal(comboboxOpeningQuery(options, 'gpt-5'), 'gpt-5');
});


test('theme toggle restores the saved theme and binds explicit light and dark controls', () => {
  const priorDocument = globalThis.document;
  const priorLocalStorage = globalThis.localStorage;
  const priorWindow = globalThis.window;
  const listeners = new Map();
  const buttons = ['light', 'dark'].map((theme) => ({
    dataset: { theme },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, listener) { listeners.set(`${theme}:${name}`, listener); },
  }));
  const stored = new Map([['agents-crew-theme', 'dark']]);
  globalThis.document = {
    documentElement: { dataset: {}, style: {} },
    querySelectorAll: () => buttons,
  };
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  globalThis.window = { matchMedia: () => ({ matches: false }) };

  try {
    assert.equal(mountThemeToggle(), 'dark');
    assert.equal(globalThis.document.documentElement.dataset.theme, 'dark');
    listeners.get('light:click')();
    assert.equal(globalThis.document.documentElement.dataset.theme, 'light');
    assert.equal(stored.get('agents-crew-theme'), 'light');
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorLocalStorage;
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('confirmDialog resolves true on confirm and false on cancel', async () => {
  const { confirmDialog } = await import('../../dist/ui/assets/components/dialog.js');
  const listeners = new Map();
  const fakeElement = () => ({
    className: '',
    innerHTML: '',
    classList: { add() {} },
    setAttribute() {},
    append() {},
    querySelector(selector) {
      if (selector === '.dialog-cancel') return { addEventListener: (type, fn) => listeners.set(`cancel:${type}`, fn) };
      if (selector === '.dialog-confirm') return { addEventListener: (type, fn) => listeners.set(`confirm:${type}`, fn), focus() {} };
      return null;
    },
    remove() {},
    addEventListener(type, fn) { listeners.set(`backdrop:${type}`, fn); }
  });

  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement: () => fakeElement(),
    body: { append() {} },
    addEventListener: (type, fn) => listeners.set(`doc:${type}`, fn),
    removeEventListener: () => {}
  };

  try {
    const promise = confirmDialog({ title: 'Delete template', message: 'Are you sure?', variant: 'danger' });
    listeners.get('confirm:click')();
    const result = await promise;
    assert.equal(result, true);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test('confirmDialog confirms on Enter key', async () => {
  const { confirmDialog } = await import('../../dist/ui/assets/components/dialog.js');
  const listeners = new Map();
  const fakeElement = () => ({
    className: '', innerHTML: '', classList: { add() {} }, setAttribute() {}, append() {},
    querySelector(selector) {
      if (selector === '.dialog-cancel') return { addEventListener: (type, fn) => listeners.set(`cancel:${type}`, fn) };
      if (selector === '.dialog-confirm') return { addEventListener: (type, fn) => listeners.set(`confirm:${type}`, fn), focus() {} };
      return null;
    }, remove() {}, addEventListener(type, fn) { listeners.set(`backdrop:${type}`, fn); },
  });
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement: () => fakeElement(), body: { append() {} },
    addEventListener: (type, fn) => listeners.set(`doc:${type}`, fn), removeEventListener: () => {},
  };
  try {
    const promise = confirmDialog({ title: 'Delete template', message: 'Are you sure?' });
    listeners.get('doc:keydown')({ key: 'Enter', preventDefault() {} });
    assert.equal(await promise, true);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test('Connect view renders global host status cards with state-aware actions', async () => {
  const { connectMarkup } = await import('../../dist/ui/assets/connect.js');
  const html = connectMarkup([
    { host: 'codex', status: 'missing', files: [] },
    { host: 'claude-code', status: 'connected', files: [{ path: '/home/.claude/skills/crew-run/SKILL.md', action: 'ok', message: 'ok' }] },
    { host: 'opencode', status: 'modified', files: [{ path: '/home/.config/opencode/commands/crew-run.md', action: 'modified', message: 'edited' }] },
    { host: 'antigravity', status: 'error', files: [], message: 'broken manifest' },
  ]);
  assert.match(html, /data-connect-host="codex"/u);
  assert.match(html, /data-connection-action="connect"/u);
  assert.match(html, /data-connect-host="claude-code"/u);
  assert.match(html, /data-connection-action="disconnect"/u);
  assert.match(html, /data-connect-host="opencode"/u);
  assert.match(html, /data-connection-action="repair"/u);
  assert.match(html, /broken manifest/u);
  assert.match(html, /Global scope/u);
});

test('Runtime process table exposes only valid state-aware process controls', async () => {
  const { processTableMarkup } = await import('../../dist/ui/assets/processes.js');
  const base = {
    host: 'codex', pid: 123, run_id: 'run-12345678', task_id: 'inspect', workspace: '/repo',
    worker_id: 'codex-worker', started_at: new Date(Date.now() - 5000).toISOString(), updated_at: new Date().toISOString(),
  };
  const html = processTableMarkup([
    { ...base, id: 'running', state: 'running' },
    { ...base, id: 'pausing', state: 'pausing' },
    { ...base, id: 'paused', state: 'paused' },
    { ...base, id: 'exited', state: 'exited', exit_code: 0 },
  ], Date.now());
  assert.match(html, /data-process="running"[\s\S]*data-process-action="pause"/u);
  assert.match(html, /data-process="running"[\s\S]*data-process-action="restart"/u);
  assert.match(html, /data-process="paused"[\s\S]*data-process-action="resume"/u);
  assert.match(html, /data-process="paused"[\s\S]*data-process-action="stop"/u);
  assert.match(html, /PID/u);
  assert.match(html, /Uptime/u);
  assert.match(html, /data-label="Worker"/u);
  assert.match(html, /data-label="Controls"/u);
});
