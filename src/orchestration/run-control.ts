import { advanceRun, persistRun, store } from './engine.js';
import { recoverInterruptedTasks, reopenFailedRun } from './manager.js';
import { RunProtocol } from './protocol.js';
import type { Run } from '../domain/types.js';

const immutableTerminalStatuses = new Set(['completed', 'cancelled']);

export async function selectedRunId(workspace: string, requested?: string): Promise<string> {
  const id = requested ?? await store(workspace).latestRunId();
  if (!id) throw new Error('no run found');
  return id;
}

function assertMutable(run: Run): void {
  if (immutableTerminalStatuses.has(run.status)) {
    throw new Error(`run ${run.id} is terminal (${run.status}) and can only be inspected`);
  }
}

export async function loadSelectedRun(workspace: string, requested?: string): Promise<Run> {
  return store(workspace).load(await selectedRunId(workspace, requested));
}

export async function resumeRun(workspace: string, requested?: string): Promise<Run> {
  const run = await loadSelectedRun(workspace, requested);
  assertMutable(run);
  if (run.status === 'blocked' && run.approvals.some((approval) => approval.status === 'rejected')) {
    throw new Error(`run ${run.id} is blocked by a rejected approval`);
  }
  if (run.status === 'failed') {
    await reopenFailedRun(workspace, run);
    await persistRun(workspace, run);
    return run;
  }
  if (await recoverInterruptedTasks(workspace, run)) {
    await persistRun(workspace, run);
    return run;
  }
  if (run.status === 'paused') {
    if (run.approvals.some((approval) => approval.status === 'pending')) run.status = 'awaiting_approval';
    else if ((await store(workspace).pendingActions(run.id)).length) run.status = 'manager_required';
    else run.status = 'working';
    await store(workspace).appendEvent(run.id, 'run_resumed', { restored_status: run.status });
  } else if (run.status === 'blocked') {
    run.status = 'working';
    await store(workspace).appendEvent(run.id, 'run_resumed', { restored_status: run.status });
  }
  if (run.status !== 'manager_required' && run.status !== 'awaiting_approval') {
    await advanceRun(workspace, await new RunProtocol(workspace).loadSnapshot(run.id), run);
  }
  await persistRun(workspace, run);
  return run;
}

export async function changeRunStatus(
  workspace: string,
  requested: string | undefined,
  next: 'paused' | 'cancelled',
  source = 'cli',
): Promise<Run> {
  const run = await loadSelectedRun(workspace, requested);
  assertMutable(run);
  if (run.status === next) return run;
  run.status = next;
  if (next === 'cancelled') run.terminal_summary = source === 'ui' ? 'Cancelled from local UI' : 'Cancelled by user';
  await store(workspace).appendEvent(run.id, next === 'paused' ? 'run_paused' : 'run_cancelled', { status: next, source });
  await persistRun(workspace, run);
  return run;
}

export async function decideRunApproval(
  workspace: string,
  requested: string | undefined,
  approvalId: string,
  approved: boolean,
): Promise<Run> {
  const run = await loadSelectedRun(workspace, requested);
  assertMutable(run);
  const approval = run.approvals.find((item) => item.id === approvalId);
  if (!approval) throw new Error('approval not found');
  if (approval.status !== 'pending') throw new Error(`approval ${approvalId} is already decided`);
  approval.status = approved ? 'approved' : 'rejected';
  approval.decided_at = new Date().toISOString();
  if (approved) {
    for (const task of Object.values(run.tasks)) {
      if (approval.operation.startsWith(`task:${task.id}:`) && task.status === 'blocked') task.status = 'retryable';
    }
    run.status = 'working';
  } else {
    run.status = 'blocked';
  }
  await persistRun(workspace, run);
  await store(workspace).appendEvent(run.id, 'approval_decided', { approval_id: approvalId, approved });
  return run;
}
