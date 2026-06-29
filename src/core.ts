import { randomUUID } from 'node:crypto';
import type {
  ManagerIdentity, Run, Task, TaskDraft, WorkerResult, WorkspaceMode,
} from './types.js';


const validRoles = new Set(['manager', 'planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator']);
const validCapabilities = new Set(['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive']);
const validResultStatuses = new Set(['completed', 'failed', 'blocked']);
const validTestStatuses = new Set(['passed', 'failed', 'skipped', 'blocked']);

function requiredText(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
}

function stringList(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${name} must be a string array`);
}

function validateWriteScope(scope: string): void {
  if (!scope || scope.includes('\0') || /^[a-zA-Z]:[\\/]/u.test(scope) || scope.startsWith('/') || scope.startsWith('\\')) {
    throw new Error(`invalid write scope: ${scope}`);
  }
  if (scope !== '.' && scope.split(/[\\/]+/u).some((part) => part === '..')) throw new Error(`invalid write scope: ${scope}`);
}

function validateTaskDraft(draft: TaskDraft): void {
  requiredText(draft.title, 'task title');
  requiredText(draft.instructions, 'task instructions');
  requiredText(draft.expected_output, 'task expected_output');
  if (!validRoles.has(draft.role)) throw new Error(`invalid task role: ${String(draft.role)}`);
  stringList(draft.capabilities, 'task capabilities');
  if (draft.capabilities.some((capability) => !validCapabilities.has(capability))) throw new Error('invalid task capability');
  stringList(draft.write_scope, 'task write scope');
  for (const scope of draft.write_scope) validateWriteScope(scope);
  stringList(draft.dependencies, 'task dependencies');
  for (const dependency of draft.dependencies) {
    try { validateTaskId(dependency); } catch { throw new Error(`invalid task dependency: ${dependency}`); }
  }
  stringList(draft.preferred_workers, 'task preferred_workers');
  for (const worker of draft.preferred_workers) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(worker)) throw new Error(`invalid preferred worker id: ${worker}`);
  }
  if (!Number.isInteger(draft.max_attempts) || draft.max_attempts <= 0) throw new Error('task max_attempts must be a positive integer');
}

function validateWorkerResultShape(result: WorkerResult): void {
  if (!result || typeof result !== 'object') throw new Error('worker result must be an object');
  requiredText(result.task_id, 'worker result task_id');
  requiredText(result.summary, 'worker result summary');
  if (!validResultStatuses.has(result.status)) throw new Error(`invalid worker result status: ${String(result.status)}`);
  for (const [name, value] of Object.entries({
    artifacts: result.artifacts,
    files_changed: result.files_changed,
    capabilities_used: result.capabilities_used,
    assumptions: result.assumptions,
    blockers: result.blockers,
  })) stringList(value, `worker result ${name}`);
  if (!Array.isArray(result.commands_run) || result.commands_run.some((command) => !Array.isArray(command) || command.some((item) => typeof item !== 'string'))) {
    throw new Error('worker result commands_run must be a string matrix');
  }
  if (!Array.isArray(result.tests) || result.tests.some((test) => !test || typeof test !== 'object' || !validTestStatuses.has(test.status))) {
    throw new Error('worker result tests are invalid');
  }
  if (!Array.isArray(result.evidence) || !Array.isArray(result.recommended_next_tasks)) throw new Error('worker result evidence and recommended_next_tasks must be arrays');
  if (!result.metadata || typeof result.metadata !== 'object' || Array.isArray(result.metadata)) throw new Error('worker result metadata must be an object');
}

export interface TaskGraph { tasks: Record<string, Task> }
export interface ScheduleOptions {
  workspace_mode: WorkspaceMode;
  max_parallel_readers: number;
  max_parallel_writers: number;
  max_tasks_per_iteration: number;
}

export function validateTaskId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id) || id === '.' || id === '..') {
    throw new Error(`invalid task id: ${id}`);
  }
}

export function createTask(id: string, draft: TaskDraft): Task {
  validateTaskId(id);
  validateTaskDraft(draft);
  return {
    ...structuredClone(draft),
    id,
    inputs: [],
    status: 'pending',
    attempt: 0,
  };
}

export function taskWrites(task: Task): boolean {
  return task.capabilities.includes('write') || task.write_scope.length > 0;
}

export function createRun(goal: string, repository: string, workspaceMode: WorkspaceMode, manager: ManagerIdentity, maxIterations: number): Run {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    original_goal: goal,
    normalized_goal: goal.trim(),
    acceptance_criteria: [],
    repository,
    workspace_mode: workspaceMode,
    manager: structuredClone(manager),
    tasks: {},
    approvals: [],
    evidence: [],
    verification: [],
    status: 'planning',
    iteration: 0,
    max_iterations: maxIterations,
    event_sequence: 0,
    created_at: now,
    updated_at: now,
  };
}

export function taskGraph(tasks: Task[]): TaskGraph {
  const record: Record<string, Task> = {};
  for (const task of tasks) {
    if (record[task.id]) throw new Error(`duplicate task ${task.id}`);
    record[task.id] = structuredClone(task);
  }
  for (const task of Object.values(record)) {
    for (const dependency of task.dependencies) {
      if (!record[dependency]) throw new Error(`unknown dependency ${dependency}`);
    }
  }
  const temporary = new Set<string>();
  const complete = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (complete.has(id)) return;
    if (temporary.has(id)) throw new Error(`dependency cycle: ${[...stack, id].join(' -> ')}`);
    temporary.add(id);
    for (const dependency of record[id]?.dependencies ?? []) visit(dependency, [...stack, id]);
    temporary.delete(id);
    complete.add(id);
  };
  for (const id of Object.keys(record)) visit(id, []);
  return { tasks: record };
}

export function readyTasks(graph: TaskGraph): Task[] {
  return Object.values(graph.tasks).filter((task) => {
    if (!['pending', 'ready', 'retryable'].includes(task.status)) return false;
    return task.dependencies.every((id) => ['completed', 'cancelled'].includes(graph.tasks[id]?.status ?? 'failed'));
  });
}

export function nextBatch(graph: TaskGraph, options: ScheduleOptions): { read_task_ids: string[]; write_task_ids: string[] } {
  const reads: string[] = [];
  const writes: string[] = [];
  const totalLimit = Math.max(1, options.max_tasks_per_iteration);
  const writeLimit = options.workspace_mode === 'current' ? 1 : Math.max(1, options.max_parallel_writers);
  for (const task of readyTasks(graph)) {
    if (reads.length + writes.length >= totalLimit) break;
    if (taskWrites(task)) {
      if (writes.length < writeLimit) writes.push(task.id);
    } else if (reads.length < Math.max(1, options.max_parallel_readers)) {
      reads.push(task.id);
    }
  }
  return { read_task_ids: reads, write_task_ids: writes };
}

export function verifyTaskResult(task: Task, result: WorkerResult): void {
  validateWorkerResultShape(result);
  if (result.task_id !== task.id) throw new Error('worker result task_id mismatch');
  if (result.status !== 'completed') throw new Error(result.summary);
  if (result.capabilities_used.some((capability) => !task.capabilities.includes(capability))) {
    throw new Error('worker used capabilities outside the task envelope');
  }
  if (result.tests.some((test) => test.status === 'failed')) throw new Error('worker reported failed test');
}

export function verifyCompletion(run: Run): void {
  for (const criterion of run.acceptance_criteria) {
    if (!run.evidence.some((evidence) => evidence.criterion_id === criterion.id && evidence.passed)) {
      throw new Error(`missing criterion evidence: ${criterion.id}`);
    }
  }
  if (run.verification.some((result) => result.status === 'failed' || result.status === 'blocked')) {
    throw new Error('required verification did not pass');
  }
  if (Object.values(run.tasks).some((task) => !['completed', 'cancelled'].includes(task.status))) {
    throw new Error('not all active tasks completed');
  }
}

export function hasIndependentReview(run: Run): boolean {
  const writers = new Set(Object.values(run.tasks)
    .filter((task) => taskWrites(task) && task.status === 'completed')
    .map((task) => task.assigned_worker)
    .filter((value): value is string => Boolean(value)));
  return Object.values(run.tasks).some((task) => task.role === 'reviewer'
    && task.status === 'completed'
    && Boolean(task.assigned_worker)
    && !writers.has(task.assigned_worker as string));
}
