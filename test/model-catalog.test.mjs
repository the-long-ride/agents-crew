import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ModelCatalog, modelProvidersForHost, normalizeModelsDev } from '../dist/models/catalog.js';

const fixture = {
  openai: {
    name: 'OpenAI',
    models: {
      'gpt-5-codex': { name: 'GPT-5 Codex', reasoning: true, tool_call: true, attachment: true, limit: { context: 400000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
      'text-embedding-3-large': { name: 'Text Embedding 3 Large', reasoning: false, tool_call: false, attachment: false, limit: { context: 8191 }, modalities: { input: ['text'], output: ['embedding'] } },
      'old-codex': { name: 'Old Codex', status: 'deprecated', reasoning: false, tool_call: true, attachment: false, limit: { context: 8192 }, modalities: { input: ['text'], output: ['text'] } },
    },
  },
  anthropic: {
    name: 'Anthropic',
    models: {
      'claude-opus-4-6': { name: 'Claude Opus 4.6', reasoning: true, tool_call: true, attachment: true, limit: { context: 1000000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
    },
  },
  google: {
    name: 'Google',
    models: {
      'gemini-3-pro': { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', reasoning: true, tool_call: true, attachment: true, limit: { context: 1000000 }, modalities: { input: ['text', 'image'], output: ['text'] } },
    },
  },
};

test('host mappings select public catalog providers without credentials', () => {
  assert.deepEqual(modelProvidersForHost('codex'), ['openai']);
  assert.deepEqual(modelProvidersForHost('claude-code'), ['anthropic']);
  assert.deepEqual(modelProvidersForHost('antigravity'), ['google', 'anthropic']);
  assert.deepEqual(modelProvidersForHost('opencode'), ['*']);
  assert.deepEqual(modelProvidersForHost('custom-cli'), []);
});

test('Models.dev normalization filters deprecated entries and preserves useful metadata', () => {
  const providers = normalizeModelsDev(fixture);
  assert.equal(providers.openai.length, 1);
  assert.deepEqual(providers.openai[0], {
    id: 'gpt-5-codex', name: 'GPT-5 Codex', provider: 'openai', context: 400000,
    reasoning: true, tool_call: true, attachment: true,
  });
  assert.equal(providers.google[0].id, 'gemini-3-pro-preview');
  assert.equal(providers.openai.some((model) => model.id === 'text-embedding-3-large'), false);
});

test('OpenCode receives text LLMs from every live provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-opencode-'));
  const result = await new ModelCatalog(root, async () => fixture, () => 1000).list('opencode', true);
  assert.deepEqual(result.providers, ['anthropic', 'google', 'openai']);
  assert.deepEqual(result.models.map((model) => model.provider), ['anthropic', 'google', 'openai']);
});

test('catalog caches live data, reuses fresh cache, and serves stale cache on refresh failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-catalog-'));
  let calls = 0;
  let now = Date.parse('2026-07-29T00:00:00Z');
  const catalog = new ModelCatalog(root, async () => { calls += 1; return fixture; }, () => now);

  const live = await catalog.list('codex');
  assert.equal(live.source, 'live');
  assert.equal(live.stale, false);
  assert.equal(live.models[0].id, 'gpt-5-codex');
  assert.equal(calls, 1);

  const cached = await catalog.list('codex');
  assert.equal(cached.source, 'cache');
  assert.equal(calls, 1);

  now += 7 * 60 * 60 * 1000;
  const failing = new ModelCatalog(root, async () => { throw new Error('offline'); }, () => now);
  const stale = await failing.list('claude-code', true);
  assert.equal(stale.source, 'stale');
  assert.equal(stale.stale, true);
  assert.match(stale.error, /offline/);
  assert.equal(stale.models[0].provider, 'anthropic');
});

test('invalid live catalog never overwrites an existing valid cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-invalid-'));
  const valid = new ModelCatalog(root, async () => fixture, () => 1000);
  await valid.list('codex', true);
  const cachePath = join(root, '.agents-crew', 'cache', 'models-dev.json');
  const before = await readFile(cachePath, 'utf8');

  const invalid = new ModelCatalog(root, async () => ({ openai: { models: 'bad' } }), () => 2000);
  const result = await invalid.list('codex', true);
  assert.equal(result.source, 'stale');
  assert.match(result.error, /invalid Models.dev catalog/);
  assert.equal(await readFile(cachePath, 'utf8'), before);
});

test('corrupt cache degrades to unavailable without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-corrupt-'));
  const cachePath = join(root, '.agents-crew', 'cache', 'models-dev.json');
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, '{', 'utf8');
  const catalog = new ModelCatalog(root, async () => { throw new Error('network down'); }, () => 5000);
  const result = await catalog.list('codex');
  assert.equal(result.source, 'unavailable');
  assert.deepEqual(result.models, []);
  assert.match(result.error, /network down/);
});

test('default catalog transport uses the public endpoint without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-transport-'));
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await new ModelCatalog(root).list('codex', true);
    assert.equal(result.source, 'live');
    assert.equal(request.url, 'https://models.dev/api.json');
    assert.equal(new Headers(request.options.headers).get('accept'), 'application/json');
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.equal(new Headers(request.options.headers).has('authorization'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('default catalog transport reports HTTP failures without throwing to the UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-model-http-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  try {
    const result = await new ModelCatalog(root).list('claude-code', true);
    assert.equal(result.source, 'unavailable');
    assert.match(result.error, /HTTP 503/);
  } finally { globalThis.fetch = originalFetch; }
});
