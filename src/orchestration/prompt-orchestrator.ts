import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig, saveConfig, starterConfig } from '../config/config.js';
import { createRun, createTask } from '../domain/core.js';
import type { CrewConfig, Run, RunEvent, RunIntent, Task } from '../domain/types.js';
import { normalizeHost } from '../plugins/registry.js';
import { GitRepository } from '../runtime/git.js';
import { atomicJson, withDirectoryLock } from '../shared/durable-fs.js';
import { advanceRun, configPath, persistRun, runResponse, store } from './engine.js';
import { recoverInterruptedTasks } from './manager.js';
import { RunProtocol } from './protocol.js';

export type PromptMode = 'auto' | 'plan-only';
export type PromptComplexity = 'tiny' | 'normal' | 'complex';
export type OrchestrationPhase = 'planning' | 'executing' | 'verifying' | 'blocked' | 'completed';

export interface ExecutePromptOptions {
  workspace: string;
  host: string;
  prompt: string;
  mode?: PromptMode;
}

export interface PromptExecutionResult {
  run_id: string;
  status: Run['status'];
  resumed: boolean;
  summary?: string;
  actions: unknown[];
  pending_approvals: Run['approvals'];
  evidence: Run['evidence'];
  verification: Run['verification'];
}

export interface OrchestrationMetadata {
  request_hash: string;
  host: string;
  started_at: string;
  last_progress_at: string;
  phase: OrchestrationPhase;
  planner_revision: number;
}

const activeTerminalStatuses = new Set<Run['status']>(['completed', 'cancelled', 'failed', 'blocked']);

export function normalizePrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new Error('prompt must not be empty');
  return normalized;
}

export function requestHash(workspace: string, prompt: string): string {
  return createHash('sha256').update(`${resolve(workspace)}\n${normalizePrompt(prompt)}`).digest('hex');
}

export async function resolveOrchestrationWorkspace(start: string): Promise<string> {
  const candidate = resolve(start);
  try { return (await GitRepository.discover(candidate)).root; }
  catch { return candidate; }
}

function actionSegments(prompt: string): string[] {
  return prompt.split(/(?:\band\b|\bthen\b|[,;\n]+)/iu).map((value) => value.trim()).filter(Boolean);
}

export function classifyPrompt(prompt: string): PromptComplexity {
  const normalized = normalizePrompt(prompt);
  const segments = actionSegments(prompt);
  if (normalized.length >= 240 || segments.length >= 3) return 'complex';
  if (normalized.length <= 80 && segments.length <= 1) return 'tiny';
  return 'normal';
}

function implementationTask(prompt: string, dependencies: string[] = []): Task {
  return createTask('implement', {
    title: 'Implement the requested goal',
    instructions: `Implement this goal completely and safely in the current source repository: ${prompt}`,
    role: 'implementer', capabilities: ['read', 'write', 'shell'], write_scope: ['.'], dependencies,
    preferred_workers: [], expected_output: 'Code changes and local verification evidence', max_attempts: 2,
  });
}

function reviewTask(prompt: string, dependency: string): Task {
  return createTask('review', {
    title: 'Review the implementation for correctness',
    instructions: `Review the implementation for correctness, regressions, and unmet requirements: ${prompt}`,
    role: 'reviewer', capabilities: ['read', 'shell'], write_scope: [], dependencies: [dependency], preferred_workers: [],
    expected_output: 'Review findings and criterion evidence', max_attempts: 2,
  });
}

function promptTasks(prompt: string, config: CrewConfig): Record<string, Task> {
  const complexity = classifyPrompt(prompt);
  const reviewRequired = config.verification.require_independent_review;
  if (complexity === 'tiny') {
    const implement = implementationTask(prompt);
    return reviewRequired ? { implement, review: reviewTask(prompt, 'implement') } : { implement };
  }
  const inspect = createTask(complexity === 'complex' ? 'research' : 'inspect', {
    title: complexity === 'complex' ? 'Research implementation boundaries' : 'Inspect implementation boundaries',
    instructions: `Inspect the current repository and identify relevant files, risks, and implementation boundaries for: ${prompt}`,
    role: 'researcher', capabilities: ['read'], write_scope: [], dependencies: [], preferred_workers: [],
    expected_output: 'Repository findings and bounded implementation guidance', max_attempts: 2,
  });
  const implement = implementationTask(prompt, [inspect.id]);
  const verify = createTask('verify', {
    title: 'Verify the requested goal',
    instructions: `Verify the implementation against the requested goal and run focused tests where available: ${prompt}`,
    role: 'tester', capabilities: ['read', 'shell'], write_scope: [], dependencies: ['implement'], preferred_workers: [],
    expected_output: 'Verification evidence and test results', max_attempts: 2,
  });
  if (complexity === 'normal' && !reviewRequired) return { [inspect.id]: inspect, implement, verify };
  return { [inspect.id]: inspect, implement, verify, review: reviewTask(prompt, 'verify') };
}

function promptRun(workspace: string, prompt: string, config: CrewConfig): Run {
  const goal = normalizePrompt(prompt);
  const run = createRun(goal, workspace, config.run.workspace_mode, {
    host: config.manager.host,
    coding: config.manager.coding,
    small_fix_max_files: config.manager.small_fix_max_files,
    small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
  }, config.run.max_iterations);
  run.acceptance_criteria = [{
    id: 'goal',
    description: `The requested goal is implemented and verified: ${goal}`,
    required_checks: config.verification.commands.map((command) => command.join(' ')),
  }];
  run.tasks = promptTasks(goal, config);
  run.status = 'working';
  return run;
}

function intentFor(config: CrewConfig, goal: string): RunIntent {
  return {
    template_id: config.template?.id ?? 'prompt-orchestrator',
    template_name: config.template?.name ?? 'Agents Crew prompt orchestration',
    goal,
    expectations: [],
    acceptance_criteria: [`The requested goal is implemented and verified: ${goal}`],
    constraints: ['Work in the current configured workspace mode and obey all capability and approval policies.'],
  };
}

async function bootstrap(workspace: string, host: string): Promise<CrewConfig> {
  const root = join(workspace, '.agents-crew');
  await mkdir(root, { recursive: true });
  return withDirectoryLock(join(root, '.locks', 'bootstrap'), async () => {
    await Promise.all(['active', 'history', 'agents', 'roles', 'templates', 'plugin-manifests'].map((name) => mkdir(join(root, name), { recursive: true })));
    const path = configPath(workspace);
    if (!existsSync(path)) {
      const config = starterConfig();
      config.manager.host = normalizeHost(host);
      await saveConfig(path, config);
    }
    return loadConfig(path);
  });
}

function metadataPath(workspace: string, runId: string): string {
  return join(store(workspace).runDir(runId), 'orchestration.json');
}

function promptLockPath(workspace: string, hash: string): string {
  return join(workspace, '.agents-crew', '.locks', `prompt-${hash}`);
}

function parseMetadata(raw: string): OrchestrationMetadata | undefined {
  try {
    const value = JSON.parse(raw) as Partial<OrchestrationMetadata>;
    if (!value || typeof value.request_hash !== 'string' || typeof value.host !== 'string'
      || typeof value.started_at !== 'string' || typeof value.last_progress_at !== 'string'
      || typeof value.planner_revision !== 'number'
      || !['planning', 'executing', 'verifying', 'blocked', 'completed'].includes(String(value.phase))) return undefined;
    return value as OrchestrationMetadata;
  } catch { return undefined; }
}

async function readMetadata(workspace: string, runId: string): Promise<OrchestrationMetadata | undefined> {
  const path = metadataPath(workspace, runId);
  if (!existsSync(path)) return undefined;
  return parseMetadata(await readFile(path, 'utf8'));
}

function phaseFor(run: Run, mode: PromptMode): OrchestrationPhase {
  if (run.status === 'completed') return 'completed';
  if (mode === 'plan-only' && run.iteration === 0) return 'planning';
  if (Object.values(run.tasks).some((task) => task.status === 'verifying')) return 'verifying';
  if (['paused', 'cancelled', 'awaiting_approval', 'manager_required', 'blocked', 'failed'].includes(run.status)) return 'blocked';
  return 'executing';
}

async function saveMetadata(
  workspace: string,
  run: Run,
  request_hash: string,
  host: string,
  mode: PromptMode,
  previous?: OrchestrationMetadata,
): Promise<OrchestrationMetadata> {
  const now = new Date().toISOString();
  const metadata: OrchestrationMetadata = {
    request_hash,
    host,
    started_at: previous?.started_at ?? now,
    last_progress_at: now,
    phase: phaseFor(run, mode),
    planner_revision: previous?.planner_revision ?? 1,
  };
  await atomicJson(metadataPath(workspace, run.id), metadata);
  return metadata;
}

function promptStartedHash(events: RunEvent[]): string | undefined {
  for (const event of events) {
    if (event.kind !== 'run_started' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue;
    const data = event.data as Record<string, unknown>;
    if (data.source === 'prompt_orchestrator' && typeof data.request_hash === 'string') return data.request_hash;
  }
  return undefined;
}

async function matchingActiveRun(workspace: string, hash: string): Promise<{ run: Run; metadata?: OrchestrationMetadata } | undefined> {
  const runStore = store(workspace);
  if (!existsSync(runStore.activeRoot)) return undefined;
  let best: { run: Run; metadata?: OrchestrationMetadata } | undefined;
  for (const entry of await readdir(runStore.activeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(runStore.activeRoot, entry.name, 'run.json'))) continue;
    const run = await runStore.load(entry.name);
    if (activeTerminalStatuses.has(run.status)) continue;
    const metadata = await readMetadata(workspace, entry.name);
    const candidateHash = metadata?.request_hash ?? promptStartedHash(await runStore.readEvents(run.id));
    if (candidateHash !== hash) continue;
    if (!best || !best.metadata || (metadata && metadata.last_progress_at > best.metadata.last_progress_at)) best = { run, metadata };
  }
  return best;
}

async function resultFor(workspace: string, run: Run, resumed: boolean): Promise<PromptExecutionResult> {
  const response = await runResponse(workspace, run) as { pending_actions?: unknown[] };
  return {
    run_id: run.id,
    status: run.status,
    resumed,
    ...(run.terminal_summary ? { summary: run.terminal_summary } : {}),
    actions: response.pending_actions ?? [],
    pending_approvals: structuredClone(run.approvals.filter((approval) => approval.status === 'pending')),
    evidence: structuredClone(run.evidence),
    verification: structuredClone(run.verification),
  };
}

function missingSnapshot(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export class PromptOrchestrator {
  async execute(options: ExecutePromptOptions): Promise<PromptExecutionResult> {
    const workspace = await resolveOrchestrationWorkspace(options.workspace);
    const host = normalizeHost(options.host);
    const prompt = normalizePrompt(options.prompt);
    const mode = options.mode ?? 'auto';
    const initialConfig = await bootstrap(workspace, host);
    const hash = requestHash(workspace, prompt);

    return withDirectoryLock(promptLockPath(workspace, hash), async () => {
      const matched = await matchingActiveRun(workspace, hash);
      let config = initialConfig;
      let run: Run;
      let previousMetadata: OrchestrationMetadata | undefined;
      const resumed = Boolean(matched);
      const protocol = new RunProtocol(workspace);

      if (matched) {
        run = matched.run;
        previousMetadata = matched.metadata;
        try { config = await protocol.loadSnapshot(run.id); }
        catch (error) {
          if (!missingSnapshot(error)) throw error;
          config = { ...config, manager: { ...config.manager, host } };
          await protocol.materialize(run, config, intentFor(config, prompt));
        }
        if (await recoverInterruptedTasks(workspace, run)) await persistRun(workspace, run);
      } else {
        config = { ...config, manager: { ...config.manager, host } };
        run = promptRun(workspace, prompt, config);
        previousMetadata = await saveMetadata(workspace, run, hash, host, mode);
        await store(workspace).create(run);
        await protocol.materialize(run, config, intentFor(config, prompt));
        await store(workspace).appendEvent(run.id, 'run_started', { goal: prompt, source: 'prompt_orchestrator', request_hash: hash });
      }

      if (mode === 'auto' && run.status === 'working') await advanceRun(workspace, config, run);
      else await persistRun(workspace, run);
      await saveMetadata(workspace, run, hash, host, mode, previousMetadata);
      return resultFor(workspace, run, resumed);
    });
  }
}
