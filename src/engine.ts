import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { assetPath } from './assets.js';
import { createRun, createTask, hasIndependentReview, nextBatch, taskGraph, taskWrites, verifyCompletion, verifyTaskResult } from './core.js';
import { decidePolicy, type PolicyOperation } from './policy.js';
import { GitRepository, type ChangeSnapshot } from './git.js';
import { RunProtocol } from './protocol.js';
import { RunStore } from './state.js';
import { ApiWorker, CliWorker, type Worker, type WorkerRequest } from './workers.js';
import type { ApprovalRequest, CrewConfig, OutstandingAction, Run, Task, TestResult, WorkerConfig, WorkerResult } from './types.js';

export type Execution =
  | { type: 'result'; result: WorkerResult; worker_id: string; workspace?: string; fingerprint: string }
  | { type: 'native'; action: OutstandingAction; worker_id: string; workspace?: string; fingerprint: string }
  | { type: 'approval'; approval: ApprovalRequest }
  | { type: 'failure'; task_id: string; message: string; worker_id?: string; workspace?: string; fingerprint?: string };

export function configPath(workspace: string): string { return join(workspace, '.agents-crew', 'config.toml'); }
export function store(workspace: string): RunStore { return new RunStore(workspace); }

export function buildDefaultRun(workspace: string, goal: string, config: CrewConfig): Run {
  const run = createRun(goal, workspace, config.run.workspace_mode, {
    host: config.manager.host,
    coding: config.manager.coding,
    small_fix_max_files: config.manager.small_fix_max_files,
    small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
  }, config.run.max_iterations);
  run.acceptance_criteria = [{
    id: 'goal',
    description: `The requested goal is implemented and independently verified: ${goal}`,
    required_checks: config.verification.commands.map((command) => command.join(' ')),
  }];
  const research = createTask('research', {
    title: 'Inspect repository and define implementation boundaries',
    instructions: `Inspect the repository and return risks, relevant files, and a bounded implementation approach for: ${goal}`,
    role: 'researcher', capabilities: ['read'], write_scope: [], dependencies: [], preferred_workers: [],
    expected_output: 'Repository findings and implementation boundaries', max_attempts: 2,
  });
  const implement = createTask('implement', {
    title: 'Implement the goal', instructions: `Implement this goal completely and safely: ${goal}`,
    role: 'implementer', capabilities: ['read', 'write', 'shell'], write_scope: ['.'], dependencies: ['research'], preferred_workers: [],
    expected_output: 'Code changes and local verification evidence', max_attempts: 2,
  });
  const review = createTask('review', {
    title: 'Review and verify the implementation', instructions: `Review all changes against this goal: ${goal}`,
    role: 'reviewer', capabilities: ['read', 'shell'], write_scope: [], dependencies: ['implement'], preferred_workers: [],
    expected_output: 'Independent findings and criterion evidence', max_attempts: 2,
  });
  run.tasks = { research, implement, review };
  run.status = 'working';
  return run;
}

function approvalFor(task: Task, operation: PolicyOperation): ApprovalRequest {
  return {
    id: randomUUID(),
    operation: `task:${task.id}:${operation.type}`,
    reason: `Task ${task.id} requires ${operation.type.replaceAll('_', ' ')}`,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

function policyContext(run: Run) {
  return {
    manager_coding: run.manager.coding,
    small_fix_max_files: run.manager.small_fix_max_files,
    small_fix_max_changed_lines: run.manager.small_fix_max_changed_lines,
  } as const;
}

function operationApproved(run: Run, operation: string): boolean {
  return run.approvals.some((approval) => approval.operation === operation && approval.status === 'approved');
}

function enforceTaskPolicy(config: CrewConfig, run: Run, task: Task, worker?: WorkerConfig): ApprovalRequest | undefined {
  const operations: PolicyOperation[] = [];
  if (taskWrites(task)) operations.push({ type: 'local_edit' });
  if (task.capabilities.includes('network') || worker?.requires_network) operations.push({ type: 'network' });
  if (worker?.requires_credentials) operations.push({ type: 'credentialed_action' });
  if (task.capabilities.includes('destructive')) operations.push({ type: 'destructive_command' });
  if (task.capabilities.includes('commit')) operations.push({ type: 'commit' });
  if (task.capabilities.includes('push')) operations.push({ type: 'push' });
  if (task.capabilities.includes('deploy')) operations.push({ type: 'deploy' });
  for (const operation of operations) {
    const key = `task:${task.id}:${operation.type}`;
    if (operationApproved(run, key)) continue;
    const decision = decidePolicy(config.permissions, operation, policyContext(run));
    if (decision === 'deny') throw new Error(`policy denied ${operation.type} for task ${task.id}`);
    if (decision === 'ask') return approvalFor(task, operation);
  }
  return undefined;
}

function eligibleConfig(config: CrewConfig, task: Task): WorkerConfig[] {
  return config.workers.filter((worker) => worker.enabled
    && worker.roles.includes(task.role)
    && task.capabilities.every((capability) => worker.capabilities.includes(capability))
    && !(worker.kind === 'api' && taskWrites(task))
    && (!task.preferred_workers.length || task.preferred_workers.includes(worker.id)))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

async function rolePrompt(task: Task): Promise<string> {
  return readFile(assetPath('roles', `${task.role}.md`), 'utf8');
}

function fingerprint(worker: WorkerConfig, task: Task, workspace: string): string {
  return createHash('sha256').update(JSON.stringify({ worker: worker.id, model: worker.model, task: task.instructions, workspace })).digest('hex');
}

function taskVisibleChanges(paths: string[]): string[] {
  return paths.filter((path) => path !== '.agents-crew' && !path.startsWith('.agents-crew/'));
}

async function discoverRepository(path: string): Promise<GitRepository | undefined> {
  try { return await GitRepository.discover(path); } catch { return undefined; }
}

async function createNativeAction(
  workspace: string,
  run: Run,
  task: Task,
  worker: WorkerConfig,
  binding: string,
  snapshot: ChangeSnapshot,
): Promise<OutstandingAction> {
  const action: OutstandingAction = {
    id: randomUUID(), run_id: run.id, task_id: task.id, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    capability_envelope: [...task.capabilities], consumed: false,
    action: {
      type: 'dispatch_native', task_id: task.id, role: task.role, model: worker.model,
      model_fallback: worker.model_fallback ?? 'allow_host_default', capabilities: [...task.capabilities],
      workspace: binding,
      context_path: join(store(workspace).runDir(run.id), 'context', `task-${task.id}.md`),
      output_schema: assetPath('schemas', 'worker-result.schema.json'),
      workspace_snapshot: snapshot,
    },
  };
  await store(workspace).saveAction(action);
  return action;
}

async function selectExecutable(config: CrewConfig, task: Task): Promise<{ config: WorkerConfig; worker?: Worker }> {
  const candidates = eligibleConfig(config, task);
  for (const candidate of candidates) {
    if (candidate.kind === 'native') return { config: candidate };
    const worker = candidate.kind === 'cli'
      ? new CliWorker(candidate, config.run.default_task_timeout_seconds)
      : new ApiWorker(candidate);
    const probe = await worker.probe();
    if (probe.available) return { config: candidate, worker };
  }
  throw new Error(`no eligible worker for task ${task.id}`);
}

async function executeTask(workspace: string, config: CrewConfig, run: Run, task: Task): Promise<Execution> {
  let binding = workspace;
  let mainRepository: GitRepository | undefined;
  try {
    const selected = await selectExecutable(config, task);
    const approval = enforceTaskPolicy(config, run, task, selected.config);
    if (approval) return { type: 'approval', approval };
    if (taskWrites(task) && config.run.workspace_mode === 'isolated') {
      mainRepository = await GitRepository.discover(workspace);
      binding = await mainRepository.createTaskWorktree(run.id, task.id);
    }
    const repository = await discoverRepository(binding);
    if (taskWrites(task) && !repository) throw new Error(`write task ${task.id} requires a Git repository`);
    const before = repository ? await repository.snapshotChanges(binding) : {};
    const strategy = fingerprint(selected.config, task, binding);
    if (selected.config.kind === 'native') {
      const action = await createNativeAction(workspace, run, task, selected.config, binding, before);
      return { type: 'native', action, worker_id: selected.config.id, workspace: binding, fingerprint: strategy };
    }
    const outputPath = join(store(workspace).runDir(run.id), 'artifacts', `${task.id}-${selected.config.id}.json`);
    const request: WorkerRequest = {
      run_id: run.id,
      task,
      workspace: binding,
      context_path: join(store(workspace).runDir(run.id), 'context', `task-${task.id}.md`),
      output_path: outputPath,
      role_prompt: await rolePrompt(task),
      model: selected.config.model,
      model_fallback: selected.config.model_fallback ?? 'allow_host_default',
      timeout_seconds: selected.config.timeout_seconds ?? config.run.default_task_timeout_seconds,
      workspace_mode: config.run.workspace_mode,
    };
    const result = await selected.worker?.execute(request);
    if (!result) throw new Error('selected worker did not execute');
    verifyTaskResult(task, result);
    const actualChanges = repository ? taskVisibleChanges(await repository.changedSince(before, binding)) : [...result.files_changed];
    if (!taskWrites(task) && actualChanges.length) throw new Error(`read-only task changed files: ${actualChanges.join(', ')}`);
    if (repository) repository.validateWriteScope(task.write_scope, actualChanges);
    result.files_changed = actualChanges;
    if (taskWrites(task) && config.run.workspace_mode === 'isolated' && binding !== workspace) {
      mainRepository ??= await GitRepository.discover(workspace);
      await mainRepository.integrateTaskWorktree(binding);
      await mainRepository.cleanupTaskWorktree(binding);
    }
    return { type: 'result', result, worker_id: selected.config.id, workspace: binding, fingerprint: strategy };
  } catch (error) {
    return { type: 'failure', task_id: task.id, message: error instanceof Error ? error.message : String(error), workspace: binding === workspace ? undefined : binding };
  }
}

function addRecommendedTasks(run: Run, source: Task, result: WorkerResult): void {
  for (const [index, draft] of result.recommended_next_tasks.entries()) {
    const base = `${source.id}-next-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (run.tasks[id]) { id = `${base}-${suffix}`; suffix += 1; }
    run.tasks[id] = createTask(id, draft);
  }
}

async function issueReview(workspace: string, run: Run, taskId: string, kind = 'review'): Promise<void> {
  const action: OutstandingAction = {
    id: randomUUID(), run_id: run.id, task_id: taskId, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), capability_envelope: [], consumed: false,
    action: { type: 'review', task_id: taskId, state_path: join(store(workspace).runDir(run.id), 'run.json'), output_schema: assetPath('schemas', 'manager-decision.schema.json') },
  };
  await store(workspace).saveAction(action);
  await store(workspace).appendEvent(run.id, 'manager_action_issued', { action_id: action.id, type: kind, task_id: taskId });
}

async function markFailure(workspace: string, run: Run, taskId: string, message: string): Promise<void> {
  const task = run.tasks[taskId];
  if (!task) throw new Error(`missing task ${taskId}`);
  task.attempt += 1;
  if (task.attempt < task.max_attempts) {
    task.status = 'retryable';
    await issueReview(workspace, run, taskId);
    run.status = 'manager_required';
  } else {
    task.status = 'failed';
    run.status = 'failed';
    run.terminal_summary = `task ${taskId} failed: ${message}`;
  }
  await store(workspace).appendEvent(run.id, 'task_failed', { task_id: taskId, error: message });
}

async function handleExecution(workspace: string, config: CrewConfig, run: Run, execution: Execution): Promise<void> {
  if (execution.type === 'result') {
    const task = run.tasks[execution.result.task_id];
    if (!task) throw new Error(`missing task ${execution.result.task_id}`);
    task.status = 'verifying';
    task.assigned_worker = execution.worker_id;
    task.workspace_binding = execution.workspace;
    task.strategy_fingerprint = execution.fingerprint;
    task.result = execution.result;
    task.status = 'completed';
    run.evidence.push(...execution.result.evidence);
    run.verification.push(...execution.result.tests);
    addRecommendedTasks(run, task, execution.result);
    await store(workspace).appendEvent(run.id, 'task_completed', { task_id: task.id, worker: execution.worker_id });
    return;
  }
  if (execution.type === 'native') {
    const id = execution.action.task_id;
    if (id && run.tasks[id]) {
      run.tasks[id].status = 'blocked';
      run.tasks[id].assigned_worker = execution.worker_id;
      run.tasks[id].workspace_binding = execution.workspace;
      run.tasks[id].strategy_fingerprint = execution.fingerprint;
    }
    run.status = 'manager_required';
    await store(workspace).appendEvent(run.id, 'manager_action_issued', { action_id: execution.action.id, type: 'dispatch_native' });
    return;
  }
  if (execution.type === 'approval') {
    if (!run.approvals.some((item) => item.operation === execution.approval.operation && item.status === 'pending')) run.approvals.push(execution.approval);
    const taskId = execution.approval.operation.split(':')[1];
    if (taskId && run.tasks[taskId]) run.tasks[taskId].status = 'blocked';
    run.status = 'awaiting_approval';
    await store(workspace).appendEvent(run.id, 'approval_requested', execution.approval);
    return;
  }
  if (execution.workspace && !config.run.retain_failed_worktrees) {
    try { await (await GitRepository.discover(workspace)).cleanupTaskWorktree(execution.workspace); } catch { /* best effort */ }
  }
  await markFailure(workspace, run, execution.task_id, execution.message);
}

function runCommand(command: string[], cwd: string): Promise<TestResult> {
  if (!command.length) return Promise.resolve({ command, status: 'blocked', summary: 'empty verification command' });
  return new Promise((resolve) => {
    const child = spawn(command[0] as string, command.slice(1), { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error: Error) => resolve({ command, status: 'blocked', summary: error.message }));
    child.on('close', (code: number | null) => resolve({ command, status: code === 0 ? 'passed' : 'failed', summary: (code === 0 ? stdout : stderr).trim() || `exit ${code}`, exit_code: code ?? 1 }));
  });
}

async function finishOrBlock(workspace: string, config: CrewConfig, run: Run): Promise<void> {
  if (!Object.values(run.tasks).every((task) => ['completed', 'cancelled'].includes(task.status))) {
    run.status = 'blocked';
    run.terminal_summary = 'No schedulable task remains';
    return;
  }
  if (config.verification.require_independent_review && !config.verification.allow_same_agent_review && !hasIndependentReview(run)) {
    run.status = 'failed';
    run.terminal_summary = 'independent review is required but no distinct reviewer completed';
    return;
  }
  if (config.verification.commands.length) {
    const operation = 'run:test_command';
    if (!operationApproved(run, operation)) {
      const decision = decidePolicy(config.permissions, { type: 'test_command' }, policyContext(run));
      if (decision === 'deny') { run.status = 'failed'; run.terminal_summary = 'policy denied verification commands'; return; }
      if (decision === 'ask') {
        run.approvals.push({ id: randomUUID(), operation, reason: 'Configured verification commands require approval', status: 'pending', created_at: new Date().toISOString() });
        run.status = 'awaiting_approval';
        return;
      }
    }
  }
  run.verification.push(...await Promise.all(config.verification.commands.map((command) => runCommand(command, workspace))));
  try {
    verifyCompletion(run);
    run.status = 'completed';
    run.terminal_summary = 'All tasks completed with criterion evidence';
  } catch (error) {
    run.status = 'failed';
    run.terminal_summary = error instanceof Error ? error.message : String(error);
  }
}

export async function persistRun(workspace: string, run: Run): Promise<void> {
  const runStore = store(workspace);
  await runStore.save(run);
  const protocol = new RunProtocol(workspace);
  if (run.status === 'completed' || run.status === 'cancelled') {
    try { await (await GitRepository.discover(workspace)).cleanupRunWorktrees(run.id); } catch { /* repository can be absent */ }
    if (existsSync(runStore.activeRunDir(run.id))) await protocol.archiveTerminal(run);
  } else await protocol.sync(run);
}

export async function advanceRun(workspace: string, config: CrewConfig, run: Run): Promise<void> {
  while (!['paused', 'cancelled', 'awaiting_approval', 'manager_required', 'completed', 'failed', 'blocked'].includes(run.status)) {
    const graph = taskGraph(Object.values(run.tasks));
    const batch = nextBatch(graph, config.run);
    if (!batch.read_task_ids.length && !batch.write_task_ids.length) { await finishOrBlock(workspace, config, run); break; }
    if (run.iteration >= run.max_iterations) { run.status = 'failed'; run.terminal_summary = 'iteration limit exhausted'; break; }
    run.iteration += 1;
    const ids = [...batch.read_task_ids, ...batch.write_task_ids];
    for (const id of ids) if (run.tasks[id]) run.tasks[id].status = 'running';
    await persistRun(workspace, run);
    for (const id of ids) await store(workspace).appendEvent(run.id, 'task_started', { task_id: id, iteration: run.iteration });
    const reads = await Promise.all(batch.read_task_ids.map((id) => executeTask(workspace, config, run, run.tasks[id] as Task)));
    for (const execution of reads) await handleExecution(workspace, config, run, execution);
    if (['awaiting_approval', 'manager_required', 'failed', 'blocked'].includes(run.status)) { await persistRun(workspace, run); break; }
    if (config.run.workspace_mode === 'isolated') {
      const writes = await Promise.all(batch.write_task_ids.map((id) => executeTask(workspace, config, run, run.tasks[id] as Task)));
      for (const execution of writes) await handleExecution(workspace, config, run, execution);
    } else {
      for (const id of batch.write_task_ids) await handleExecution(workspace, config, run, await executeTask(workspace, config, run, run.tasks[id] as Task));
    }
    await persistRun(workspace, run);
  }
}

export async function runResponse(workspace: string, run: Run): Promise<unknown> {
  return { run, pending_actions: await store(workspace).pendingActions(run.id), expired_actions: [] };
}
