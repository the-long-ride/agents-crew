import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTask } from '../dist/domain/core.js';
import { CliWorker, WorkerRouter } from '../dist/runtime/workers.js';

function task(id, writes = false) {
  return createTask(id, {
    title: id, instructions: 'work', role: writes ? 'implementer' : 'researcher',
    capabilities: writes ? ['read', 'write', 'shell'] : ['read'], write_scope: writes ? ['.'] : [],
    dependencies: [], preferred_workers: [], expected_output: 'result', max_attempts: 2,
  });
}

test('router prefers eligible high-priority workers', () => {
  const workers = [
    { descriptor: { id: 'low', kind: 'cli', roles: ['researcher'], capabilities: ['read'], priority: 1 }, probe: async () => ({ available: true }), execute: async () => ({}) },
    { descriptor: { id: 'high', kind: 'cli', roles: ['researcher'], capabilities: ['read'], priority: 9 }, probe: async () => ({ available: true }), execute: async () => ({}) },
  ];
  const selected = new WorkerRouter(workers).select(task('r'), {});
  assert.equal(selected.descriptor.id, 'high');
});

test('CLI worker reads normalized result file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-worker-'));
  const script = join(root, 'fake.mjs');
  await writeFile(script, `import { writeFileSync } from 'node:fs'; const out = process.argv.at(-1); writeFileSync(out, JSON.stringify({task_id:'t',status:'completed',summary:'ok',artifacts:[],files_changed:[],commands_run:[],capabilities_used:['read'],tests:[],evidence:[],assumptions:[],blockers:[],recommended_next_tasks:[],metadata:{}}));`);
  const context = join(root, 'context.md');
  await writeFile(context, 'context');
  const worker = new CliWorker({
    id: 'fake', kind: 'cli', enabled: true, command: process.execPath,
    args: [script, '{output}'], roles: ['researcher'], capabilities: ['read'], priority: 1,
    env_allowlist: [], headers: {}, timeout_seconds: 10,
  }, 10);
  const result = await worker.execute({ task: task('t'), workspace: root, context_path: context, role_prompt: 'role' });
  assert.equal(result.summary, 'ok');
});



test('CLI worker preserves platform environment required by Node command shims', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-worker-platform-env-'));
  const script = join(root, 'env.mjs');
  const context = join(root, 'context.md');
  await writeFile(context, 'context');
  await writeFile(script, `console.log(JSON.stringify({task_id:'env',status:'completed',summary:[process.env.USERPROFILE,process.env.APPDATA,process.env.LOCALAPPDATA,process.env.PATHEXT,process.env.SHELL].join('|'),artifacts:[],files_changed:[],commands_run:[],capabilities_used:['read'],tests:[],evidence:[],assumptions:[],blockers:[],recommended_next_tasks:[],metadata:{}}));`);
  const previous = Object.fromEntries(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'SHELL'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { USERPROFILE: 'profile', APPDATA: 'roaming', LOCALAPPDATA: 'local', PATHEXT: '.EXE;.CMD', SHELL: '/bin/test-shell' });
  try {
    const worker = new CliWorker({
      id: 'env', kind: 'cli', enabled: true, command: process.execPath, args: [script], roles: ['researcher'], capabilities: ['read'], priority: 1,
      env_allowlist: [], headers: {}, timeout_seconds: 10,
    }, 10);
    const result = await worker.execute({ task: task('env'), workspace: root, context_path: context, role_prompt: 'role' });
    assert.equal(result.summary, 'profile|roaming|local|.EXE;.CMD|/bin/test-shell');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('CLI worker probes commands and supplies adapter defaults', async () => {
  const base = {
    id: 'probe', kind: 'cli', enabled: true, roles: ['researcher'], capabilities: ['read'], priority: 1,
    env_allowlist: [], headers: {}, args: [], adapter: 'claude-code',
  };
  const configured = new CliWorker({ ...base, command: process.execPath }, 10);
  assert.equal(configured.command, process.execPath);
  assert.equal(configured.args.includes('--output-format'), true);
  assert.equal((await configured.probe()).available, true);
  const missing = new CliWorker({ ...base, command: join(process.cwd(), 'missing-command') }, 1);
  assert.equal((await missing.probe()).available, false);
});

test('CLI worker accepts stdout JSON and rejects failures and mismatched task ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-worker-output-'));
  const context = join(root, 'context.md');
  await writeFile(context, 'context');
  const stdoutScript = join(root, 'stdout.mjs');
  await writeFile(stdoutScript, `console.log('log line'); console.log(JSON.stringify({task_id:'t',status:'completed',summary:'stdout',artifacts:[],files_changed:[],commands_run:[],capabilities_used:['read'],tests:[],evidence:[],assumptions:[],blockers:[],recommended_next_tasks:[],metadata:{}}));`);
  const stdoutWorker = new CliWorker({
    id: 'stdout', kind: 'cli', enabled: true, command: process.execPath, args: [stdoutScript], roles: ['researcher'], capabilities: ['read'], priority: 1,
    env_allowlist: [], headers: {}, timeout_seconds: 10,
  }, 10);
  assert.equal((await stdoutWorker.execute({ task: task('t'), workspace: root, context_path: context, role_prompt: 'role' })).summary, 'stdout');

  const mismatchScript = join(root, 'mismatch.mjs');
  await writeFile(mismatchScript, `console.log(JSON.stringify({task_id:'other',status:'completed',summary:'bad',artifacts:[],files_changed:[],commands_run:[],capabilities_used:[],tests:[],evidence:[],assumptions:[],blockers:[],recommended_next_tasks:[],metadata:{}}));`);
  const mismatch = new CliWorker({ ...stdoutWorker.config, id: 'mismatch', args: [mismatchScript] }, 10);
  await assert.rejects(mismatch.execute({ task: task('t'), workspace: root, context_path: context, role_prompt: 'role' }), /task_id mismatch/);

  const failureScript = join(root, 'failure.mjs');
  await writeFile(failureScript, `console.error(process.env.CREW_TEST_SECRET); process.exit(2);`);
  process.env.CREW_TEST_SECRET = 'secret-value';
  const failure = new CliWorker({ ...stdoutWorker.config, id: 'failure', args: [failureScript], env_allowlist: ['CREW_TEST_SECRET'] }, 10);
  await assert.rejects(failure.execute({ task: task('t'), workspace: root, context_path: context, role_prompt: 'role' }), /\[REDACTED\]/);
  delete process.env.CREW_TEST_SECRET;
});

test('API worker handles OpenAI and Anthropic JSON while remaining read-only', async () => {
  const { ApiWorker } = await import('../dist/runtime/workers.js');
  const root = await mkdtemp(join(tmpdir(), 'agents-crew-api-worker-'));
  const context = join(root, 'context.md');
  await writeFile(context, 'context');
  const readTask = task('api');
  const request = { task: readTask, workspace: root, context_path: context, role_prompt: 'role', timeout_seconds: 10 };
  const originalFetch = globalThis.fetch;
  process.env.CREW_API_KEY = 'key';
  try {
    const openai = new ApiWorker({
      id: 'api', kind: 'api', enabled: true, provider: 'openai', model: 'model', api_key_env: 'CREW_API_KEY',
      roles: ['researcher'], capabilities: ['read', 'network'], priority: 1, args: [], env_allowlist: [], headers: {},
    });
    assert.equal((await openai.probe()).available, true);
    globalThis.fetch = async (_url, options) => {
      assert.match(options.headers.authorization, /Bearer key/);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ task_id: 'api', status: 'completed', summary: 'openai', artifacts: [], files_changed: [], commands_run: [], capabilities_used: ['read'], tests: [], evidence: [], assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {} }) } }] }) };
    };
    assert.equal((await openai.execute(request)).summary, 'openai');
    await assert.rejects(openai.execute({ ...request, task: task('write', true) }), /cannot execute write tasks/);

    const anthropic = new ApiWorker({ ...openai.config, id: 'anthropic', provider: 'anthropic', api_base_url: 'https://example.test/v1/' });
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://example.test/v1/messages');
      assert.equal(options.headers['x-api-key'], 'key');
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ text: `\`\`\`json\n${JSON.stringify({ task_id: 'api', status: 'completed', summary: 'anthropic', artifacts: [], files_changed: [], commands_run: [], capabilities_used: ['read'], tests: [], evidence: [], assumptions: [], blockers: [], recommended_next_tasks: [], metadata: {} })}\n\`\`\`` }] }) };
    };
    assert.equal((await anthropic.execute(request)).summary, 'anthropic');

    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'key rejected' });
    await assert.rejects(openai.execute(request), /\[REDACTED\]/);
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [] }) });
    await assert.rejects(openai.execute(request), /no text content/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CREW_API_KEY;
  }
  const missing = new ApiWorker({
    id: 'missing', kind: 'api', enabled: true, provider: 'openai', model: 'model', api_key_env: 'CREW_MISSING_KEY',
    roles: ['researcher'], capabilities: ['read'], priority: 1, args: [], env_allowlist: [], headers: {},
  });
  assert.equal((await missing.probe()).available, false);
  await assert.rejects(missing.execute(request), /missing environment variable/);
});

test('router enforces preferences and model-selection fallback', () => {
  const worker = { descriptor: { id: 'one', kind: 'cli', roles: ['researcher'], capabilities: ['read'], priority: 1, supports_model_selection: false }, probe: async () => ({ available: true }), execute: async () => ({}) };
  const preferred = task('preferred');
  preferred.preferred_workers = ['other'];
  assert.throws(() => new WorkerRouter([worker]).select(preferred, {}), /no eligible worker/);
  assert.throws(() => new WorkerRouter([worker]).select(task('model'), { required_model: 'x', model_fallback: 'deny' }), /no eligible worker/);
});

test('API worker rejects unsafe endpoint protocols at construction', async () => {
  const { ApiWorker } = await import('../dist/runtime/workers.js');
  const base = {
    id: 'unsafe-api', kind: 'api', enabled: true, provider: 'openai', model: 'model', api_key_env: 'CREW_KEY',
    roles: ['researcher'], capabilities: ['read'], priority: 1, args: [], env_allowlist: [], headers: {},
  };
  assert.throws(() => new ApiWorker({ ...base, api_base_url: 'file:///tmp/secret' }), /HTTP or HTTPS/i);
  assert.throws(() => new ApiWorker({ ...base, api_base_url: 'not a url' }), /valid URL/i);
});
