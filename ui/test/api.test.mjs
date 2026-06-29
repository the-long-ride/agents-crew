import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJson, setApiToken } from '../../dist/ui/assets/api.js';

test('API client rejects external and non-API paths before fetch', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected fetch'); };
  await assert.rejects(() => requestJson('https://example.com/data'), /same-origin/);
  await assert.rejects(() => requestJson('/assets/app.js'), /same-origin/);
  assert.equal(called, false);
});

test('API client sends launch token and returns JSON', async () => {
  setApiToken('secret');
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/bootstrap');
    assert.equal(new Headers(options.headers).get('x-agents-crew-token'), 'secret');
    return new Response(JSON.stringify({ templates: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const result = await requestJson('/api/bootstrap');
  assert.deepEqual(result, { templates: [] });
});

test('API client reports server error payload', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'bad template' }), { status: 400 });
  await assert.rejects(() => requestJson('/api/templates/bad'), /bad template/);
});
