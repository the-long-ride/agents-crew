import { randomUUID } from 'node:crypto';
import { taskWrites } from './core.js';
import { decidePolicy, type PolicyOperation } from './policy.js';
import type { ApprovalRequest, CrewConfig, Run, Task, WorkerConfig } from './types.js';

export function policyContext(run: Run) {
  return {
    manager_coding: run.manager.coding,
    small_fix_max_files: run.manager.small_fix_max_files,
    small_fix_max_changed_lines: run.manager.small_fix_max_changed_lines,
  } as const;
}

export function operationApproved(run: Run, operation: string): boolean {
  return run.approvals.some((approval) => approval.operation === operation && approval.status === 'approved');
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

export function enforceTaskPolicy(config: CrewConfig, run: Run, task: Task, worker?: WorkerConfig): ApprovalRequest | undefined {
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
