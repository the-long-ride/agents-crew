import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdapter, createAntigravityAdapter, createCodexAdapter, registerAdapter, getRegisteredAdapters } from '../dist/index.js';

test('creates built-in adapters for target agents', () => {
  for (const kind of ['antigravity', 'codex', 'claude-code', 'opencode', 'github-copilot']) {
    const adapter = createAdapter(kind, {});
    assert.equal(adapter.kind, kind);
  }
});

test('antigravity hook skips when desktop is still active', () => {
  const adapter = createAdapter('antigravity', {});
  const decision = adapter.handleHook({
    task: { conversationId: 'c1' },
    input: { fullyIdle: false, terminationReason: 'model_stop', conversationId: 'c1' },
  });
  assert.equal(decision.decision, 'stop');
  assert.match(decision.reason, /active work|still active/i);
});

test('antigravity hook skips for non-model_stop termination', () => {
  const adapter = createAdapter('antigravity', {});
  const decision = adapter.handleHook({
    task: { conversationId: 'c1' },
    input: { fullyIdle: true, terminationReason: 'error', conversationId: 'c1' },
  });
  assert.equal(decision.decision, 'stop');
  assert.match(decision.reason, /termination reason/i);
});

test('antigravity hook approves review when idle and model_stop', () => {
  const adapter = createAdapter('antigravity', {});
  const decision = adapter.handleHook({
    task: { conversationId: 'c1' },
    input: { fullyIdle: true, terminationReason: 'model_stop', conversationId: 'c1' },
  });
  assert.equal(decision.decision, 'review');
});

test('antigravity hook rejects mismatched conversationId', () => {
  const adapter = createAdapter('antigravity', {});
  assert.throws(
    () => adapter.handleHook({
      task: { conversationId: 'c1' },
      input: { fullyIdle: true, terminationReason: 'model_stop', conversationId: 'c2' },
    }),
    /conversation/,
  );
});

test('antigravity run throws hook-only error', () => {
  const adapter = createAdapter('antigravity', {});
  assert.throws(
    () => adapter.run({ workspaceRoot: '.', contextPath: '.', schemaPath: '.', timeoutMs: 1000 }),
    /hook-based/,
  );
});

test('antigravity validateConfig is no-op', () => {
  const adapter = createAdapter('antigravity', {});
  assert.doesNotThrow(() => adapter.validateConfig({}));
  assert.doesNotThrow(() => adapter.validateConfig(null));
});

test('codex adapter defaults to read-only review command', () => {
  const adapter = createAdapter('codex', {});
  const request = adapter.buildRunRequest({
    workspaceRoot: 'repo',
    contextPath: 'repo/.agents-crew/CONTEXT.md',
    schemaPath: 'schemas/review.schema.json',
    timeoutMs: 300000,
  });
  assert.equal(request.command, 'codex');
  assert.ok(request.args.includes('exec'));
  assert.ok(request.args.includes('read-only'));
});

test('codex adapter accepts custom command', () => {
  const adapter = createCodexAdapter({ command: 'custom-codex' });
  const request = adapter.buildRunRequest({
    workspaceRoot: 'repo',
    contextPath: 'ctx',
    schemaPath: 'schema',
    timeoutMs: 1000,
  });
  assert.equal(request.command, 'custom-codex');
});

test('codex adapter accepts prefix args', () => {
  const adapter = createCodexAdapter({ prefixArgs: ['--preview'] });
  const request = adapter.buildRunRequest({
    workspaceRoot: 'repo',
    contextPath: 'ctx',
    schemaPath: 'schema',
    timeoutMs: 1000,
  });
  assert.ok(request.args.includes('--preview'));
});

test('codex validateConfig is no-op', () => {
  const adapter = createAdapter('codex', {});
  assert.doesNotThrow(() => adapter.validateConfig({}));
});

test('claude-code adapter defaults to claude command', () => {
  const adapter = createAdapter('claude-code', {});
  assert.equal(adapter.kind, 'claude-code');
});

test('opencode adapter defaults to opencode command', () => {
  const adapter = createAdapter('opencode', {});
  assert.equal(adapter.kind, 'opencode');
});

test('github-copilot adapter defaults to gh command', () => {
  const adapter = createAdapter('github-copilot', {});
  assert.equal(adapter.kind, 'github-copilot');
});

test('createAdapter throws for unknown kind', () => {
  assert.throws(() => createAdapter('unknown-kind', {}), /Unknown adapter/);
});

test('registerAdapter adds custom adapter', () => {
  const customFactory = () => createAntigravityAdapter({});
  registerAdapter('custom-test', customFactory);
  const adapter = createAdapter('custom-test', {});
  assert.equal(adapter.kind, 'antigravity');
});

test('getRegisteredAdapters returns all kinds', () => {
  const kinds = getRegisteredAdapters();
  assert.ok(kinds.length >= 6);
  assert.ok(kinds.includes('antigravity'));
  assert.ok(kinds.includes('codex'));
  assert.ok(kinds.includes('process'));
});
