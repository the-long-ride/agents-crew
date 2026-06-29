import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { assetPath } from './assets.js';
import { loadConfig } from './config.js';
import { createRun, createTask, taskWrites, verifyCompletion, verifyTaskResult } from './core.js';
import { advanceRun, configPath, persistRun, runResponse, store } from './engine.js';
import { GitRepository } from './git.js';
import { RunProtocol } from './protocol.js';
import type {
  AcceptanceCriterion, ApprovalRequest, Capability, CrewConfig, OutstandingAction, Run, RunIntent, Task, TaskDraft, WorkerResult,
} from './types.js';

export interface ReviewDecision { task_id: string; approved: boolean; findings: string[] }
export interface CompletionClaim { summary: string }
export interface ManagerApprovalDraft { id: string; operation: string; reason: string; created_at?: string }
export interface ManagerDecision {
  acceptance_criteria?: AcceptanceCriterion[];
  tasks_to_add?: Array<Task | (TaskDraft & { id?: string })>;
  tasks_to_cancel?: string[];
  review_decisions?: ReviewDecision[];
  approval_requests?: ManagerApprovalDraft[];
  should_continue: boolean;
  completion_claim?: CompletionClaim | null;
}

function templateIntent(config: CrewConfig, goal: string): RunIntent {
  return {
    template_id: config.template?.id ?? 'workspace-config',
    template_name: config.template?.name ?? 'Workspace config',
    goal,
    expectations: [],
    acceptance_criteria: [],
    constraints: [],
  };
}

function planAction(workspace: string, run: Run, goal: string): OutstandingAction {
  return {
    id: randomUUID(), run_id: run.id, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    capability_envelope: [], consumed: false,
    action: {
      type: 'plan', goal,
      state_path: join(store(workspace).runDir(run.id), 'run.json'),
      output_schema: assetPath('schemas', 'manager-decision.schema.json'),
    },
  };
}

function reviewAction(workspace: string, run: Run, taskId: string): OutstandingAction {
  return {
    id: randomUUID(), run_id: run.id, task_id: taskId, issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    capability_envelope: [], consumed: false,
    action: {
      type: 'review', task_id: taskId,
      state_path: join(store(workspace).runDir(run.id), 'run.json'),
      output_schema: assetPath('schemas', 'manager-decision.schema.json'),
    },
  };
}

export async function managerStart(workspace: string, goal: string, host: string): Promise<unknown> {
  const config = await loadConfig(configPath(workspace));
  const run = createRun(goal, workspace, config.run.workspace_mode, {
    host,
    coding: config.manager.coding,
    small_fix_max_files: config.manager.small_fix_max_files,
    small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
  }, config.run.max_iterations);
  await store(workspace).create(run);
  await new RunProtocol(workspace).materialize(run, config, templateIntent(config, goal));
  const action = planAction(workspace, run, goal);
  await store(workspace).saveAction(action);
  await store(workspace).appendEvent(run.id, 'manager_action_issued', { action_id: action.id, type: 'plan' });
  return { run_id: run.id, actions: [action] };
}

export async function recoverInterruptedTasks(workspace: string, run: Run): Promise<boolean> {
  const interrupted = Object.values(run.tasks).filter((task) => ['running', 'verifying'].includes(task.status));
  if (!interrupted.length) return false;
  const pending = new Set((await store(workspace).pendingActions(run.id)).map((action) => action.task_id).filter(Boolean));
  for (const task of interrupted) {
    task.status = 'blocked';
    if (pending.has(task.id)) continue;
    const action = reviewAction(workspace, run, task.id);
    await store(workspace).saveAction(action);
    await store(workspace).appendEvent(run.id, 'manager_action_issued', { action_id: action.id, type: 'recovery_review', task_id: task.id });
  }
  run.status = 'manager_required';
  run.terminal_summary = `Interrupted task state detected for ${interrupted.map((task) => task.id).join(', ')}; inspect repository/worktrees before replanning`;
  return true;
}

export async function reopenFailedRun(workspace: string, run: Run): Promise<void> {
  const pending = await store(workspace).pendingActions(run.id);
  if (pending.length) { run.status = 'manager_required'; return; }
  const taskId = Object.values(run.tasks).find((task) => ['failed', 'blocked'].includes(task.status))?.id ?? 'run-recovery';
  const action = reviewAction(workspace, run, taskId);
  await store(workspace).saveAction(action);
  await store(workspace).appendEvent(run.id, 'manager_action_issued', { action_id: action.id, type: 'failed_run_recovery', task_id: taskId });
  run.status = 'manager_required';
  run.terminal_summary = 'Failed run reopened for manager recovery review using durable context';
}

export async function managerStep(workspace: string, runId: string): Promise<unknown> {
  const protocol = new RunProtocol(workspace);
  const config = await protocol.loadSnapshot(runId);
  const run = await store(workspace).load(runId);
  if (await recoverInterruptedTasks(workspace, run)) await persistRun(workspace, run);
  const expired = await store(workspace).expiredActions(runId);
  const pending = await store(workspace).pendingActions(runId);
  if (expired.length) {
    run.status = 'blocked';
    run.terminal_summary = `${expired.length} manager action(s) expired; inspect the workspace and start a fresh action or run`;
    await persistRun(workspace, run);
  } else if (!pending.length && run.status === 'working') {
    await advanceRun(workspace, config, run);
    await persistRun(workspace, run);
  }
  return runResponse(workspace, run);
}

function normalizeTask(raw: Task | (TaskDraft & { id?: string }), run: Run, index: number): Task {
  const id = 'id' in raw && raw.id ? raw.id : `manager-task-${run.iteration + 1}-${index + 1}`;
  if (run.tasks[id]) throw new Error(`duplicate task ${id}`);
  const draft: TaskDraft = {
    title: raw.title,
    instructions: raw.instructions,
    role: raw.role,
    capabilities: [...(raw.capabilities ?? [])],
    write_scope: [...(raw.write_scope ?? [])],
    dependencies: [...(raw.dependencies ?? [])],
    preferred_workers: [...(raw.preferred_workers ?? [])],
    expected_output: raw.expected_output,
    max_attempts: raw.max_attempts ?? 2,
  };
  return createTask(id, draft);
}

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }

function validateManagerDecision(decision: ManagerDecision): void {
  if (!decision || typeof decision !== 'object') throw new Error('manager decision must be an object');
  if (typeof decision.should_continue !== 'boolean') throw new Error('manager decision should_continue must be boolean');
  for (const key of ['acceptance_criteria', 'tasks_to_add', 'tasks_to_cancel', 'review_decisions', 'approval_requests'] as const) {
    if (decision[key] !== undefined && !Array.isArray(decision[key])) throw new Error(`manager decision ${key} must be an array`);
  }
  for (const criterion of decision.acceptance_criteria ?? []) {
    if (!nonEmpty(criterion.id) || !nonEmpty(criterion.description)
      || (criterion.required_checks !== undefined && (!Array.isArray(criterion.required_checks) || criterion.required_checks.some((item) => typeof item !== 'string')))) {
      throw new Error('manager acceptance criterion is invalid');
    }
  }
  if ((decision.tasks_to_cancel ?? []).some((id) => !nonEmpty(id))) throw new Error('manager decision tasks_to_cancel contains an invalid id');
  for (const review of decision.review_decisions ?? []) {
    if (!review || !nonEmpty(review.task_id) || typeof review.approved !== 'boolean'
      || !Array.isArray(review.findings) || review.findings.some((item) => typeof item !== 'string')) {
      throw new Error('manager review decision is invalid');
    }
  }
  for (const approval of decision.approval_requests ?? []) {
    if (!approval || !nonEmpty(approval.id) || !nonEmpty(approval.operation) || !nonEmpty(approval.reason)) throw new Error('manager approval request is invalid');
  }
  if (decision.completion_claim !== undefined && decision.completion_claim !== null
    && (!decision.completion_claim || !nonEmpty(decision.completion_claim.summary))) throw new Error('manager completion claim is invalid');
}

function applyReviewDecision(run: Run, decision: ReviewDecision): void {
  const task = run.tasks[decision.task_id];
  if (!task) throw new Error(`review references unknown task ${decision.task_id}`);
  if (decision.approved) {
    if (['failed', 'blocked', 'retryable'].includes(task.status)) task.status = 'retryable';
  } else {
    task.status = task.attempt < task.max_attempts ? 'retryable' : 'failed';
    if (task.status === 'failed') run.terminal_summary = `review rejected task ${task.id}: ${decision.findings.join('; ')}`;
  }
}

export function applyManagerDecision(run: Run, decision: ManagerDecision): void {
  validateManagerDecision(decision);
  if (decision.acceptance_criteria) run.acceptance_criteria = decision.acceptance_criteria.map((criterion) => ({ ...structuredClone(criterion), required_checks: [...(criterion.required_checks ?? [])] }));
  for (const [index, raw] of (decision.tasks_to_add ?? []).entries()) {
    const task = normalizeTask(raw, run, index);
    run.tasks[task.id] = task;
  }
  for (const id of decision.tasks_to_cancel ?? []) {
    const task = run.tasks[id];
    if (!task) throw new Error(`cannot cancel unknown task ${id}`);
    if (!['completed', 'cancelled'].includes(task.status)) task.status = 'cancelled';
  }
  for (const review of decision.review_decisions ?? []) applyReviewDecision(run, review);
  for (const approval of decision.approval_requests ?? []) {
    if (!run.approvals.some((item) => item.id === approval.id)) run.approvals.push({ ...approval, status: 'pending', created_at: approval.created_at ?? new Date().toISOString() });
  }
  if (decision.completion_claim && !decision.should_continue) {
    verifyCompletion(run);
    run.status = 'completed';
    run.terminal_summary = decision.completion_claim.summary;
  } else if (run.approvals.some((approval) => approval.status === 'pending')) {
    run.status = 'awaiting_approval';
  } else if (Object.values(run.tasks).some((task) => task.status === 'failed')) {
    run.status = 'failed';
  } else {
    run.status = 'working';
    run.terminal_summary = undefined;
  }
}

function taskVisibleChanges(paths: string[]): string[] {
  return paths.filter((path) => path !== '.agents-crew' && !path.startsWith('.agents-crew/'));
}

async function inspectNativeWorkspace(
  task: Task,
  action: Extract<OutstandingAction['action'], { type: 'dispatch_native' }>,
  result: WorkerResult,
  resultPath: string,
): Promise<string[]> {
  let repository: GitRepository | undefined;
  try { repository = await GitRepository.discover(action.workspace); } catch { /* read-only non-Git workspaces remain supported */ }
  if (taskWrites(task) && !repository) throw new Error(`write task ${task.id} requires a Git repository`);
  const submitted = relative(resolve(action.workspace), resolve(resultPath));
  const ignoredResult = submitted && !submitted.startsWith('..') && !isAbsolute(submitted) ? submitted.replaceAll('\\', '/') : undefined;
  const actual = repository
    ? taskVisibleChanges(await repository.changedSince(action.workspace_snapshot ?? {}, action.workspace)).filter((path) => path !== ignoredResult)
    : [...result.files_changed];
  if (!taskWrites(task) && actual.length) throw new Error(`read-only task changed files: ${actual.join(', ')}`);
  if (repository) repository.validateWriteScope(task.write_scope, actual);
  return actual;
}

async function integrateNativeWorkspace(workspace: string, config: CrewConfig, task: Task): Promise<void> {
  if (!task.workspace_binding || task.workspace_binding === workspace || config.run.workspace_mode !== 'isolated') return;
  const repository = await GitRepository.discover(workspace);
  await repository.integrateTaskWorktree(task.workspace_binding);
  await repository.cleanupTaskWorktree(task.workspace_binding);
}

export async function submitManagerResult(workspace: string, runId: string, actionId: string, resultPath: string): Promise<unknown> {
  const protocol = new RunProtocol(workspace);
  const config = await protocol.loadSnapshot(runId);
  const runStore = store(workspace);
  const outstanding = await runStore.loadAction(runId, actionId);
  const raw = JSON.parse(await readFile(resultPath, 'utf8')) as unknown;
  const run = await runStore.load(runId);
  if (outstanding.action.type === 'plan' || outstanding.action.type === 'review') {
    applyManagerDecision(run, raw as ManagerDecision);
    await runStore.consumeAction(runId, actionId, []);
  } else if (outstanding.action.type === 'dispatch_native') {
    const result = raw as WorkerResult;
    if (!result.capabilities_used?.length && outstanding.action.capabilities.length) throw new Error('native result must report capabilities_used');
    if (result.task_id !== outstanding.task_id) throw new Error('native result task_id mismatch');
    const task = run.tasks[result.task_id];
    if (!task) throw new Error(`missing task ${result.task_id}`);
    verifyTaskResult(task, result);
    result.files_changed = await inspectNativeWorkspace(task, outstanding.action, result, resultPath);
    await runStore.consumeAction(runId, actionId, result.capabilities_used as Capability[]);
    try {
      await integrateNativeWorkspace(workspace, config, task);
      task.status = 'completed';
      task.result = result;
      run.evidence.push(...(result.evidence ?? []));
      run.verification.push(...(result.tests ?? []));
      run.status = 'working';
      run.terminal_summary = undefined;
    } catch (error) {
      task.attempt += 1;
      task.status = task.attempt < task.max_attempts ? 'retryable' : 'failed';
      run.status = task.status === 'failed' ? 'failed' : 'manager_required';
      run.terminal_summary = error instanceof Error ? error.message : String(error);
      if (task.status === 'retryable') {
        const action = reviewAction(workspace, run, task.id);
        await runStore.saveAction(action);
      }
    }
  } else {
    throw new Error('action type cannot accept a file submission');
  }
  await persistRun(workspace, run);
  await runStore.appendEvent(runId, 'manager_action_submitted', { action_id: actionId, task_id: outstanding.task_id });
  return runResponse(workspace, run);
}
