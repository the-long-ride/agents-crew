import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Capability, ModelFallback, Role, Task, WorkerConfig, WorkerResult, WorkspaceMode } from '../domain/types.js';
import { ProcessRegistry, type ManagedProcessControl } from './process-registry.js';

export interface WorkerDescriptor {
  id: string;
  kind: WorkerConfig['kind'] | 'fake';
  roles: Role[];
  capabilities: Capability[];
  priority: number;
  enabled?: boolean;
  supports_model_selection?: boolean;
  configured_model?: string;
  requires_network?: boolean;
  requires_credentials?: boolean;
}
export interface WorkerProbe { available: boolean; version?: string; capabilities?: Capability[]; message?: string }
export interface WorkerRequest {
  run_id?: string;
  task: Task;
  workspace: string;
  context_path: string;
  output_path?: string;
  role_prompt: string;
  model?: string;
  model_fallback?: ModelFallback;
  timeout_seconds?: number;
  workspace_mode?: WorkspaceMode;
  registry_workspace?: string;
}
export interface Worker { descriptor: WorkerDescriptor; probe(): Promise<WorkerProbe>; execute(request: WorkerRequest): Promise<WorkerResult> }

function defaultExecutable(adapter: string): string {
  if (adapter === 'claude-code' || adapter === 'claude') return 'claude';
  return adapter;
}
function defaultArgs(adapter: string): string[] {
  if (adapter === 'codex') return ['exec', '--model', '{model}', '--sandbox', 'workspace-write', '-C', '{workspace}', '{prompt}'];
  if (adapter === 'claude-code' || adapter === 'claude') return ['-p', '--output-format', 'json', '--model', '{model}', '{prompt}'];
  if (adapter === 'opencode' || adapter === 'antigravity') return ['run', '--model', '{model}', '{prompt}'];
  return ['{prompt}'];
}
function safeEnvironment(allowlist: string[]): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SHELL']) if (process.env[key]) output[key] = process.env[key];
  for (const key of allowlist) if (process.env[key]) output[key] = process.env[key];
  return output;
}
function redact(text: string, keys: string[]): string {
  return keys.reduce((output, key) => process.env[key] ? output.replaceAll(process.env[key] as string, '[REDACTED]') : output, text);
}
function extractJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const last = trimmed.split(/\r?\n/u).at(-1)?.trim();
  return last?.startsWith('{') && last.endsWith('}') ? last : undefined;
}
interface ProcessRunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  onSpawn?: (pid: number) => Promise<void>;
  pollControl?: () => Promise<ManagedProcessControl | undefined>;
}

function runProcess(command: string, args: string[], options: ProcessRunOptions): Promise<{ stdout: string; stderr: string; code: number; control?: ManagedProcessControl }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let control: ManagedProcessControl | undefined;
    let polling = false;
    const ready = child.pid && options.onSpawn ? options.onSpawn(child.pid) : Promise.resolve();
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const poller = options.pollControl ? setInterval(() => {
      if (polling || control) return;
      polling = true;
      void ready.then(() => options.pollControl?.()).then((requested) => {
        if (requested) { control = requested; child.kill(); }
      }).catch((error: unknown) => { child.kill(); reject(error); }).finally(() => { polling = false; });
    }, 50) : undefined;
    const cleanup = () => { if (poller) clearInterval(poller); clearTimeout(timer); };
    const timer = setTimeout(() => { cleanup(); child.kill(); reject(new Error('worker timed out')); }, options.timeout * 1000);
    ready.catch((error: unknown) => { cleanup(); child.kill(); reject(error); });
    child.on('error', (error: Error) => { cleanup(); reject(error); });
    child.on('close', (code: number | null) => {
      cleanup();
      void ready.then(() => resolve({ stdout, stderr, code: code ?? 1, control })).catch(reject);
    });
  });
}

export class WorkerProcessControlError extends Error {
  constructor(readonly action: ManagedProcessControl) {
    super(`worker ${action} requested`);
    this.name = 'WorkerProcessControlError';
  }
}

export class CliWorker implements Worker {
  readonly descriptor: WorkerDescriptor;
  readonly command: string;
  readonly args: string[];
  readonly timeout: number;
  readonly allowlist: string[];

  constructor(readonly config: WorkerConfig, defaultTimeout: number) {
    const adapter = config.adapter ?? 'custom';
    this.command = config.command ?? defaultExecutable(adapter);
    this.args = config.args.length ? config.args : defaultArgs(adapter);
    this.timeout = config.timeout_seconds ?? defaultTimeout;
    this.allowlist = config.env_allowlist;
    this.descriptor = {
      id: config.id, kind: 'cli', roles: config.roles, capabilities: config.capabilities, priority: config.priority,
      enabled: config.enabled, supports_model_selection: true, configured_model: config.model,
      requires_network: config.requires_network ?? true, requires_credentials: config.requires_credentials ?? true,
    };
  }

  async probe(): Promise<WorkerProbe> {
    try {
      const result = await runProcess(this.command, ['--version'], { cwd: process.cwd(), env: safeEnvironment(this.allowlist), timeout: Math.min(10, this.timeout) });
      return { available: result.code === 0, version: result.stdout.trim(), capabilities: this.descriptor.capabilities, message: result.code === 0 ? 'available' : result.stderr.trim() };
    } catch (error) {
      return { available: false, capabilities: this.descriptor.capabilities, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async interpolate(request: WorkerRequest, outputPath: string): Promise<string[]> {
    const context = await readFile(request.context_path, 'utf8');
    const prompt = `${request.role_prompt}\n\nTASK:\n${request.task.instructions}\n\nCONTEXT:\n${context}\n\nWrite a WorkerResult JSON object for task ${request.task.id} to ${outputPath}. Stay inside capabilities ${JSON.stringify(request.task.capabilities)} and write scope ${JSON.stringify(request.task.write_scope)}. Include criterion-linked evidence.`;
    const model = request.model ?? this.descriptor.configured_model;
    const output: string[] = [];
    for (const argument of this.args) {
      if (argument === '{model}' && !model) {
        if (['--model', '-m'].includes(output.at(-1) ?? '')) output.pop();
        continue;
      }
      const value = argument.replaceAll('{model}', model ?? '').replaceAll('{prompt}', prompt).replaceAll('{workspace}', request.workspace).replaceAll('{output}', outputPath);
      if (value) output.push(value);
    }
    return output;
  }

  async execute(request: WorkerRequest): Promise<WorkerResult> {
    const outputPath = request.output_path ?? `${request.workspace}/.agents-crew/results/${request.task.id}.json`;
    await mkdir(dirname(outputPath), { recursive: true });
    const registry = request.run_id ? new ProcessRegistry(request.registry_workspace ?? request.workspace) : undefined;
    let processId: string | undefined;
    let result: { stdout: string; stderr: string; code: number; control?: ManagedProcessControl };
    try {
      result = await runProcess(this.command, await this.interpolate(request, outputPath), {
        cwd: request.workspace, env: safeEnvironment(this.allowlist), timeout: Math.min(request.timeout_seconds ?? this.timeout, this.timeout),
        onSpawn: registry && request.run_id ? async (pid) => {
          const record = await registry.register({
            worker_id: this.descriptor.id, host: this.config.adapter ?? 'custom', pid, run_id: request.run_id as string,
            task_id: request.task.id, workspace: request.workspace,
          });
          processId = record.id;
        } : undefined,
        pollControl: registry ? async () => processId ? (await registry.consumeControl(processId))?.action : undefined : undefined,
      });
    } catch (error) {
      if (registry && processId) await registry.complete(processId, 'failed', undefined, error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (registry && processId) {
      const current = await registry.get(processId);
      await registry.complete(processId, current?.state === 'pausing' ? 'paused' : 'exited', result.code);
    }
    if (result.control) throw new WorkerProcessControlError(result.control);
    if (result.code !== 0) throw new Error(`execution failed: ${redact(result.stderr, this.allowlist)}`);
    let raw: string;
    try { await access(outputPath); raw = await readFile(outputPath, 'utf8'); }
    catch { raw = extractJson(result.stdout) ?? ''; }
    if (!raw) throw new Error('worker produced no result file or JSON object');
    const parsed = JSON.parse(raw.trim()) as WorkerResult;
    if (parsed.task_id !== request.task.id) throw new Error('task_id mismatch');
    return parsed;
  }
}

export class ApiWorker implements Worker {
  readonly descriptor: WorkerDescriptor;
  readonly provider: string;
  readonly baseUrl: string;
  readonly keyEnv: string;
  constructor(readonly config: WorkerConfig) {
    this.provider = config.provider ?? '';
    const endpoint = config.api_base_url ?? (this.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1');
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { throw new Error('API base URL must be a valid URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API base URL must use HTTP or HTTPS');
    this.baseUrl = parsed.toString().replace(/\/$/u, '');
    this.keyEnv = config.api_key_env ?? '';
    this.descriptor = { id: config.id, kind: 'api', roles: config.roles, capabilities: config.capabilities, priority: config.priority, enabled: config.enabled, supports_model_selection: true, configured_model: config.model, requires_network: true, requires_credentials: true };
  }
  async probe(): Promise<WorkerProbe> { return { available: Boolean(process.env[this.keyEnv]), capabilities: this.descriptor.capabilities, message: `credential env ${this.keyEnv} ${process.env[this.keyEnv] ? 'present' : 'missing'}` }; }
  async execute(request: WorkerRequest): Promise<WorkerResult> {
    if (request.task.capabilities.includes('write') || request.task.write_scope.length) throw new Error('API workers cannot execute write tasks');
    const key = process.env[this.keyEnv];
    if (!key) throw new Error(`missing environment variable ${this.keyEnv}`);
    const context = await readFile(request.context_path, 'utf8');
    const prompt = `${request.role_prompt}\n\nTask ID: ${request.task.id}\nRole: ${request.task.role}\nInstructions: ${request.task.instructions}\n\nRepository context:\n${context}\n\nReturn only a JSON WorkerResult. API workers are read-only and must not claim local edits.`;
    const anthropic = this.provider === 'anthropic';
    const response = await fetch(`${this.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` }), ...this.config.headers },
      body: JSON.stringify(anthropic
        ? { model: request.model ?? this.config.model, max_tokens: 4096, temperature: 0, messages: [{ role: 'user', content: prompt }] }
        : { model: request.model ?? this.config.model, messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout((request.timeout_seconds ?? this.config.timeout_seconds ?? 900) * 1000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.replaceAll(key, '[REDACTED]')}`);
    const value = JSON.parse(text) as { choices?: { message?: { content?: string } }[]; content?: { text?: string }[] };
    const raw = (anthropic ? value.content?.find((block) => block.text)?.text : value.choices?.[0]?.message?.content)?.replace(/^```(?:json)?\s*|\s*```$/gu, '').trim();
    if (!raw) throw new Error('provider response has no text content');
    const result = JSON.parse(raw) as WorkerResult;
    if (result.task_id !== request.task.id) throw new Error('task_id mismatch');
    if (result.files_changed.length) throw new Error('API worker claimed local file changes');
    return result;
  }
}

export class WorkerRouter {
  constructor(readonly workers: Worker[]) {}
  select(task: Task, context: { required_model?: string; model_fallback?: ModelFallback }): Worker {
    const eligible = this.workers.filter((worker) => (worker.descriptor.enabled ?? true)
      && worker.descriptor.roles.includes(task.role)
      && task.capabilities.every((capability) => worker.descriptor.capabilities.includes(capability))
      && !(worker.descriptor.kind === 'api' && task.capabilities.includes('write'))
      && (!task.preferred_workers.length || task.preferred_workers.includes(worker.descriptor.id))
      && !(context.required_model && !worker.descriptor.supports_model_selection && context.model_fallback === 'deny'));
    eligible.sort((left, right) => right.descriptor.priority - left.descriptor.priority || left.descriptor.id.localeCompare(right.descriptor.id));
    const worker = eligible[0];
    if (!worker) throw new Error(`no eligible worker for task ${task.id}`);
    return worker;
  }
}
