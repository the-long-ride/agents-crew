import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseToml, stringifyToml, type TomlDocument } from './toml.js';
import type { CrewConfig, WorkerConfig } from './types.js';

const roles = ['manager', 'planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator'] as const;
const capabilities = ['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive'] as const;
const permissions = ['allow', 'ask', 'deny'] as const;

export function starterConfig(): CrewConfig {
  return {
    version: 1,
    run: {
      workspace_mode: 'current',
      max_iterations: 8,
      max_parallel_readers: 4,
      max_parallel_writers: 2,
      max_tasks_per_iteration: 8,
      default_task_timeout_seconds: 900,
      retain_failed_worktrees: true,
    },
    manager: {
      host: 'claude-code',
      alias: 'Manager',
      coding: 'small_fixes',
      small_fix_max_files: 3,
      small_fix_max_changed_lines: 120,
    },
    autonomy: { mode: 'balanced' },
    permissions: {
      local_read: 'allow',
      local_edit: 'allow',
      test_commands: 'allow',
      network: 'ask',
      destructive_commands: 'ask',
      credentialed_actions: 'ask',
      commit: 'ask',
      push: 'ask',
      deploy: 'ask',
    },
    verification: {
      commands: [],
      require_independent_review: true,
      allow_same_agent_review: true,
    },
    workers: [{
      id: 'manager-native',
      alias: 'Native worker',
      kind: 'native',
      enabled: true,
      host: 'manager',
      model_fallback: 'allow_host_default',
      roles: ['planner', 'researcher', 'implementer', 'tester', 'reviewer'],
      capabilities: ['read', 'write', 'shell'],
      priority: 100,
      args: [],
      env_allowlist: [],
      headers: {},
      requires_network: false,
      requires_credentials: false,
    }],
  };
}

function requiredPositive(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function validateWorker(worker: WorkerConfig, ids: Set<string>): void {
  if (!worker.id.trim()) throw new Error('worker id must not be empty');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(worker.id)) throw new Error(`invalid worker id ${worker.id}`);
  if (ids.has(worker.id)) throw new Error(`duplicate worker id ${worker.id}`);
  ids.add(worker.id);
  if (worker.enabled && worker.roles.length === 0) throw new Error(`worker ${worker.id} has no roles`);
  if (worker.roles.some((role) => !roles.includes(role))) throw new Error(`worker ${worker.id} has invalid role`);
  if (worker.capabilities.some((capability) => !capabilities.includes(capability))) throw new Error(`worker ${worker.id} has invalid capability`);
  if (worker.kind === 'api' && worker.capabilities.includes('write')) throw new Error(`api worker ${worker.id} cannot write`);
  if (worker.api_key_env && !/^[A-Z0-9_]+$/.test(worker.api_key_env)) throw new Error(`invalid api key env ${worker.api_key_env}`);
  if (worker.kind === 'cli' && !worker.adapter && !worker.command) throw new Error(`cli worker ${worker.id} needs adapter or command`);
  if (worker.kind === 'api' && (!worker.provider || !worker.model || !worker.api_key_env)) {
    throw new Error(`api worker ${worker.id} needs provider, model, api_key_env`);
  }
  if (worker.api_base_url) {
    let endpoint: URL;
    try { endpoint = new URL(worker.api_base_url); } catch { throw new Error(`api worker ${worker.id} needs a valid HTTP(S) api_base_url`); }
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error(`api worker ${worker.id} api_base_url must use HTTP(S)`);
  }
  if (worker.timeout_seconds !== undefined) requiredPositive(worker.timeout_seconds, `worker ${worker.id} timeout`);
}

export function validateConfig(config: CrewConfig): void {
  if (config.version !== 1) throw new Error('version must be 1');
  if (config.template && (!config.template.id.trim() || !config.template.name.trim())) throw new Error('template id and name must not be empty');
  requiredPositive(config.run.max_iterations, 'max_iterations');
  requiredPositive(config.run.max_parallel_readers, 'max_parallel_readers');
  requiredPositive(config.run.max_parallel_writers, 'max_parallel_writers');
  requiredPositive(config.run.max_tasks_per_iteration, 'max_tasks_per_iteration');
  requiredPositive(config.run.default_task_timeout_seconds, 'default_task_timeout_seconds');
  if (!['current', 'isolated'].includes(config.run.workspace_mode)) throw new Error('invalid workspace_mode');
  if (!['never', 'small_fixes', 'full'].includes(config.manager.coding)) throw new Error('invalid manager coding');
  for (const value of Object.values(config.permissions)) {
    if (!permissions.includes(value)) throw new Error(`invalid permission ${value}`);
  }
  const ids = new Set<string>();
  for (const worker of config.workers) validateWorker(worker, ids);
  if (!config.workers.some((worker) => worker.enabled)) throw new Error('at least one worker must be enabled');
}

function normalizeWorker(raw: Partial<WorkerConfig>): WorkerConfig {
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind ?? 'native',
    enabled: raw.enabled ?? true,
    roles: [...(raw.roles ?? [])],
    capabilities: [...(raw.capabilities ?? [])],
    priority: Number(raw.priority ?? 0),
    args: [...(raw.args ?? [])],
    env_allowlist: [...(raw.env_allowlist ?? [])],
    headers: { ...(raw.headers ?? {}) },
    ...(raw.alias !== undefined ? { alias: raw.alias } : {}),
    ...(raw.adapter !== undefined ? { adapter: raw.adapter } : {}),
    ...(raw.provider !== undefined ? { provider: raw.provider } : {}),
    ...(raw.host !== undefined ? { host: raw.host } : {}),
    ...(raw.model !== undefined ? { model: raw.model } : {}),
    ...(raw.model_fallback !== undefined ? { model_fallback: raw.model_fallback } : {}),
    ...(raw.command !== undefined ? { command: raw.command } : {}),
    ...(raw.api_base_url !== undefined ? { api_base_url: raw.api_base_url } : {}),
    ...(raw.api_key_env !== undefined ? { api_key_env: raw.api_key_env } : {}),
    ...(raw.timeout_seconds !== undefined ? { timeout_seconds: Number(raw.timeout_seconds) } : {}),
    ...(raw.requires_network !== undefined ? { requires_network: raw.requires_network } : {}),
    ...(raw.requires_credentials !== undefined ? { requires_credentials: raw.requires_credentials } : {}),
  };
}

export async function loadConfig(path: string): Promise<CrewConfig> {
  const raw = parseToml(await readFile(path, 'utf8')) as unknown as CrewConfig;
  const config: CrewConfig = {
    ...raw,
    template: raw.template ? { ...raw.template, description: raw.template.description ?? '', layout: raw.template.layout ?? {} } : undefined,
    run: { ...raw.run, retain_failed_worktrees: raw.run.retain_failed_worktrees ?? false },
    verification: {
      commands: raw.verification?.commands ?? [],
      require_independent_review: raw.verification?.require_independent_review ?? false,
      allow_same_agent_review: raw.verification?.allow_same_agent_review ?? false,
    },
    workers: (raw.workers ?? []).map((worker) => normalizeWorker(worker)),
  };
  validateConfig(config);
  return config;
}

export async function saveConfig(path: string, config: CrewConfig): Promise<void> {
  validateConfig(config);
  await mkdir(dirname(path), { recursive: true });
  const clean = JSON.parse(JSON.stringify(config)) as TomlDocument;
  await writeFile(path, stringifyToml(clean), 'utf8');
}
