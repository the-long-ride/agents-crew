import assert from 'node:assert/strict';
import test from 'node:test';
import { comboboxMarkup, comboboxOpeningQuery, filterOptions } from '../../dist/ui/assets/components/combobox.js';
import { infoButtonMarkup } from '../../dist/ui/assets/components/info.js';
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

test('combobox markup is accessible and contains no native select or datalist', () => {
  const html = comboboxMarkup({ id: 'model-id', value: '', options, placeholder: 'Choose model', allowCustom: true });
  assert.match(html, /role="combobox"/u);
  assert.match(html, /role="listbox"/u);
  assert.match(html, /aria-autocomplete="list"/u);
  assert.doesNotMatch(html, /<select|<datalist/iu);
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
