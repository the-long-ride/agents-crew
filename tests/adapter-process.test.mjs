import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProcessAgentAdapter } from '../dist/index.js';

test('process adapter runs configured command and parses JSON output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agents-crew-process-'));
  const runner = path.join(root, 'runner.cjs');
  await writeFile(runner, `process.stdout.write(JSON.stringify({ status: 'pass', summary: 'ok', findings: [] }) + '\\n');`);
  const adapter = createProcessAgentAdapter({
    kind: 'process',
    command: process.execPath,
    args: [runner],
  });
  const result = adapter.run({
    workspaceRoot: root,
    contextPath: path.join(root, 'CONTEXT.md'),
    schemaPath: path.join(root, 'schema.json'),
    timeoutMs: 2000,
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.summary, 'ok');
});

test('process adapter returns needs_human on non-zero exit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agents-crew-proc-exit-'));
  const runner = path.join(root, 'fail.cjs');
  await writeFile(runner, `process.exit(1);`);
  const adapter = createProcessAgentAdapter({
    kind: 'process',
    command: process.execPath,
    args: [runner],
  });
  const result = adapter.run({
    workspaceRoot: root,
    contextPath: path.join(root, 'CONTEXT.md'),
    schemaPath: path.join(root, 'schema.json'),
    timeoutMs: 2000,
  });
  assert.equal(result.status, 'needs_human');
});

test('process adapter returns needs_human on invalid JSON', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agents-crew-proc-bad-'));
  const runner = path.join(root, 'bad-output.cjs');
  await writeFile(runner, `process.stdout.write('not json\\n');`);
  const adapter = createProcessAgentAdapter({
    kind: 'process',
    command: process.execPath,
    args: [runner],
  });
  const result = adapter.run({
    workspaceRoot: root,
    contextPath: path.join(root, 'CONTEXT.md'),
    schemaPath: path.join(root, 'schema.json'),
    timeoutMs: 2000,
  });
  assert.equal(result.status, 'needs_human');
  assert.match(result.summary, /parse/i);
});

test('process adapter buildRunRequest includes context and schema', async () => {
  const adapter = createProcessAgentAdapter({
    kind: 'process',
    command: 'echo',
  });
  const request = adapter.buildRunRequest({
    workspaceRoot: '/repo',
    contextPath: '/repo/.agents-crew/CONTEXT.md',
    schemaPath: '/repo/schemas/review.schema.json',
    timeoutMs: 5000,
  });
  assert.ok(request.args.includes('--context'));
  assert.ok(request.args.includes('/repo/.agents-crew/CONTEXT.md'));
  assert.ok(request.args.includes('--schema'));
});

test('process adapter validateConfig is no-op', async () => {
  const adapter = createProcessAgentAdapter({ kind: 'process', command: 'echo' });
  assert.doesNotThrow(() => adapter.validateConfig(null));
  assert.doesNotThrow(() => adapter.validateConfig({}));
});

test('process adapter parseRunResult parses valid review JSON', () => {
  const adapter = createProcessAgentAdapter({ kind: 'process', command: 'echo' });
  const result = adapter.parseRunResult('{"status":"pass","summary":"clean","findings":[]}');
  assert.equal(result.status, 'pass');
});

test('process adapter parseRunResult returns needs_human for invalid JSON', () => {
  const adapter = createProcessAgentAdapter({ kind: 'process', command: 'echo' });
  const result = adapter.parseRunResult('not json');
  assert.equal(result.status, 'needs_human');
});
