import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { assetPath } from '../shared/assets.js';
import type { ParsedArgs } from './args.js';
import { loadConfig, saveConfig, starterConfig, validateConfig } from '../config/config.js';
import { createRun, createTask } from '../domain/core.js';
import { advanceRun, buildDefaultRun, configPath, persistRun, runResponse, store } from '../orchestration/engine.js';
import { GitRepository } from '../runtime/git.js';
import { managerStart, managerStep, submitManagerResult } from '../orchestration/manager.js';
import { HostPlugin, hosts } from '../plugins/registry.js';
import { RunProtocol } from '../orchestration/protocol.js';
import { changeRunStatus, decideRunApproval, loadSelectedRun, resumeRun } from '../orchestration/run-control.js';
import { TemplateRegistry, type TemplateScope } from '../templates/registry.js';
import type { CrewConfig, Run, RunIntent, Task } from '../domain/types.js';
import { ApiWorker, CliWorker } from '../runtime/workers.js';
import { serveUi } from '../ui/server.js';

const roleNames = ['manager', 'planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator'] as const;

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}
function optionalText(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function bool(value: unknown): boolean { return value === true; }
function positional(args: Record<string, unknown>): string[] { return Array.isArray(args.positional) ? args.positional.map(String) : []; }

async function init(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const root = join(workspace, '.agents-crew');
  await Promise.all(['roles', 'active', 'history', 'templates', 'plugin-manifests'].map((name) => mkdir(join(root, name), { recursive: true })));
  const path = configPath(workspace);
  if (!existsSync(path) || bool(args.force)) await saveConfig(path, starterConfig());
  for (const role of roleNames) {
    const destination = join(root, 'roles', `${role}.md`);
    if (!existsSync(destination) || bool(args.force)) await cp(assetPath('roles', `${role}.md`), destination);
  }
  return { initialized: true, config: path, non_interactive: bool(args.non_interactive), next: ['crew plugin install <host>', 'crew doctor'] };
}

function intentFor(config: CrewConfig, goal: string, values?: Partial<RunIntent>): RunIntent {
  return {
    template_id: values?.template_id ?? config.template?.id ?? 'workspace-config',
    template_name: values?.template_name ?? config.template?.name ?? 'Workspace config',
    goal,
    expectations: values?.expectations ?? [],
    acceptance_criteria: values?.acceptance_criteria ?? [],
    constraints: values?.constraints ?? [],
  };
}

async function createAndAdvance(workspace: string, config: CrewConfig, run: Run, intent: RunIntent): Promise<unknown> {
  await store(workspace).create(run);
  await new RunProtocol(workspace).materialize(run, config, intent);
  await store(workspace).appendEvent(run.id, 'run_started', { goal: run.original_goal, template_id: intent.template_id });
  await advanceRun(workspace, config, run);
  await persistRun(workspace, run);
  return runResponse(workspace, run);
}

async function runGoal(workspace: string, goal: string): Promise<unknown> {
  const config = await loadConfig(configPath(workspace));
  const run = buildDefaultRun(workspace, goal, config);
  return createAndAdvance(workspace, config, run, intentFor(config, goal, {
    acceptance_criteria: run.acceptance_criteria.map((criterion) => criterion.description),
  }));
}

async function startTemplate(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const templateId = text(args.template_id, 'template id');
  const goal = text(args.goal, 'goal');
  const template = await new TemplateRegistry(workspace).resolve(templateId);
  const run = buildDefaultRun(workspace, goal, template.config);
  const supplied = Array.isArray(args.acceptance_criteria) ? args.acceptance_criteria.map(String) : [];
  if (supplied.length) run.acceptance_criteria = supplied.map((description, index) => ({ id: `criterion-${index + 1}`, description, required_checks: [] }));
  return createAndAdvance(workspace, template.config, run, intentFor(template.config, goal, {
    template_id: template.id,
    template_name: template.name,
    expectations: Array.isArray(args.expectations) ? args.expectations.map(String) : [],
    acceptance_criteria: supplied.length ? supplied : run.acceptance_criteria.map((criterion) => criterion.description),
    constraints: Array.isArray(args.constraints) ? args.constraints.map(String) : [],
  }));
}

async function status(workspace: string, requested?: string): Promise<unknown> {
  return runResponse(workspace, await loadSelectedRun(workspace, requested));
}

async function doctor(workspace: string): Promise<unknown> {
  let config: CrewConfig | undefined;
  let configError: string | undefined;
  try { config = await loadConfig(configPath(workspace)); } catch (error) { configError = error instanceof Error ? error.message : String(error); }
  const workers = [];
  if (config) {
    for (const item of config.workers) {
      if (item.kind === 'native') workers.push({ id: item.id, kind: item.kind, available: true, model: item.model });
      else {
        const worker = item.kind === 'cli' ? new CliWorker(item, config.run.default_task_timeout_seconds) : new ApiWorker(item);
        const probe = await worker.probe();
        workers.push({ id: item.id, kind: item.kind, available: probe.available, model: item.model, message: probe.message });
      }
    }
  }
  let git: unknown;
  try { git = { root: (await GitRepository.discover(workspace)).root }; } catch (error) { git = { error: error instanceof Error ? error.message : String(error) }; }
  const packageJson = JSON.parse(await readFile(assetPath('package.json'), 'utf8')) as { version: string };
  return { binary_version: packageJson.version, runtime: process.version, config_valid: Boolean(config), config_error: configError, git, workers, credentials: 'Only environment-variable presence is reported; secret values are never printed.' };
}

async function templateCommand(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const subcommand = text(args.subcommand, 'template subcommand');
  const values = positional(args);
  const registry = new TemplateRegistry(workspace);
  if (subcommand === 'list') return { templates: (await registry.list()).map(({ config: _config, ...item }) => item) };
  const id = text(values[0], 'template id');
  if (subcommand === 'show') return await registry.resolve(id);
  if (subcommand === 'validate') { const item = await registry.resolve(id); validateConfig(item.config); return { id, valid: true, scope: item.scope }; }
  if (subcommand === 'delete') {
    const scope = text(args.scope, 'scope') as TemplateScope;
    if (scope === 'builtin') throw new Error('builtin templates cannot be deleted');
    await registry.delete(scope, id);
    return { id, scope, deleted: true };
  }
  throw new Error(`unknown template subcommand: ${subcommand}`);
}

async function configCommand(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const subcommand = text(args.subcommand, 'config subcommand');
  const config = await loadConfig(configPath(workspace));
  if (subcommand === 'validate') { validateConfig(config); return { valid: true }; }
  if (subcommand === 'show') return config;
  throw new Error(`unknown config subcommand: ${subcommand}`);
}

async function pluginCommand(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const subcommand = text(args.subcommand, 'plugin subcommand');
  if (subcommand === 'list') return { hosts: [...hosts] };
  const host = text(positional(args)[0], 'host');
  const plugin = new HostPlugin(host);
  if (subcommand === 'install') {
    const report = await plugin.install(workspace, bool(args.force));
    if (existsSync(configPath(workspace))) {
      const config = await loadConfig(configPath(workspace));
      config.manager.host = plugin.host;
      await saveConfig(configPath(workspace), config);
    }
    return report;
  }
  if (subcommand === 'doctor') return plugin.doctor(workspace);
  if (subcommand === 'uninstall') return plugin.uninstall(workspace);
  throw new Error(`unknown plugin subcommand: ${subcommand}`);
}

async function workerCommand(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const subcommand = text(args.subcommand, 'worker subcommand');
  if (subcommand === 'probe') return doctor(workspace);
  if (subcommand !== 'run') throw new Error(`unknown worker subcommand: ${subcommand}`);
  const [workerId, taskPath] = positional(args);
  const worker = text(workerId, 'worker');
  const config = await loadConfig(configPath(workspace));
  if (!config.workers.some((candidate) => candidate.enabled && candidate.id === worker)) throw new Error('enabled worker not found');
  const raw = JSON.parse(await readFile(text(taskPath, 'task path'), 'utf8')) as Partial<Task>;
  const task = createTask(text(raw.id, 'task id'), {
    title: raw.title as string,
    instructions: raw.instructions as string,
    role: raw.role as Task['role'],
    capabilities: raw.capabilities as Task['capabilities'],
    write_scope: raw.write_scope as string[],
    dependencies: raw.dependencies as string[],
    preferred_workers: [worker],
    expected_output: raw.expected_output as string,
    max_attempts: raw.max_attempts as number,
  });
  const run = createRun(`Execute task ${task.id} with selected worker`, workspace, config.run.workspace_mode, {
    host: config.manager.host, coding: config.manager.coding,
    small_fix_max_files: config.manager.small_fix_max_files,
    small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
  }, config.run.max_iterations);
  run.acceptance_criteria = [{ id: 'goal', description: task.expected_output, required_checks: [] }];
  run.tasks[task.id] = task;
  run.status = 'working';
  return createAndAdvance(workspace, config, run, intentFor(config, run.original_goal, { acceptance_criteria: [task.expected_output] }));
}

async function managerCommand(workspace: string, args: Record<string, unknown>): Promise<unknown> {
  const subcommand = text(args.subcommand, 'manager subcommand');
  if (subcommand === 'start') return managerStart(workspace, text(args.goal, 'goal'), text(args.host, 'host'));
  if (subcommand === 'step') return managerStep(workspace, text(args.run, 'run'));
  if (subcommand === 'submit') return submitManagerResult(workspace, text(args.run, 'run'), text(args.action, 'action'), text(args.result, 'result'));
  throw new Error(`unknown manager subcommand: ${subcommand}`);
}

export async function dispatchCommand(parsed: ParsedArgs): Promise<unknown> {
  const workspace = resolve(parsed.workspace);
  const { command, args } = parsed;
  if (command === 'init') return init(workspace, args);
  if (command === 'ui') return serveUi(workspace, Number(args.port ?? 0), bool(args.no_open));
  if (command === 'start') return startTemplate(workspace, args);
  if (command === 'run') return runGoal(workspace, text(args.goal, 'goal'));
  if (command === 'plan') {
    const config = await loadConfig(configPath(workspace));
    return { run: buildDefaultRun(workspace, text(args.goal, 'goal'), config), note: 'The manager protocol may replace this deterministic starter DAG with a richer plan.' };
  }
  if (command === 'status') return status(workspace, optionalText(args.run_id));
  if (command === 'resume') return runResponse(workspace, await resumeRun(workspace, optionalText(args.run_id)));
  if (command === 'pause') { const run = await changeRunStatus(workspace, optionalText(args.run_id), 'paused'); return { run_id: run.id, status: run.status }; }
  if (command === 'cancel') { const run = await changeRunStatus(workspace, optionalText(args.run_id), 'cancelled'); return { run_id: run.id, status: run.status }; }
  if (command === 'approve') { const run = await decideRunApproval(workspace, optionalText(args.run_id), text(args.approval_id, 'approval id'), true); return { run_id: run.id, approval_id: args.approval_id, approved: true }; }
  if (command === 'reject') { const run = await decideRunApproval(workspace, optionalText(args.run_id), text(args.approval_id, 'approval id'), false); return { run_id: run.id, approval_id: args.approval_id, approved: false }; }
  if (command === 'doctor') return doctor(workspace);
  if (command === 'template') return templateCommand(workspace, args);
  if (command === 'config') return configCommand(workspace, args);
  if (command === 'plugin') return pluginCommand(workspace, args);
  if (command === 'worker') return workerCommand(workspace, args);
  if (command === 'manager') return managerCommand(workspace, args);
  throw new Error(`unknown command: ${command}`);
}
