import fs from 'node:fs';
import { JsonStateStore } from './state/json-store';
import { getGitSnapshot } from './git/snapshot';
import { validateCrewReview } from './schema/review';
import { createAdapter } from './adapters/registry';
import { acquireWorkspaceLock } from './locks/workspace-lock';
import { appendTurn, emit, resolveSchemaPath, writeNeedsHuman, atomicWrite } from './cli-utils';

const WRITE_ROLES = new Set(['implementer']);

function isWriteRole(role: string): boolean {
  return WRITE_ROLES.has(role);
}

export function runRun(options: any, paths: any, store: JsonStateStore): number {
  if (!options.participant) throw new Error('run requires --participant <id>');
  const task = store.readTask() as any;
  if (!task) throw new Error('No active task');
  const participant = task.participants?.find((p: any) => p.id === options.participant);
  if (!participant) throw new Error(`Participant not found: ${options.participant}`);
  const adapter = createAdapter(participant.agent, participant);
  const schemaPath = resolveSchemaPath('review.schema.json');

  const lock = acquireWorkspaceLock(paths.lock, task.taskId, `run-${options.participant}`);
  try {
    const before = getGitSnapshot(options.workspace);
    if (!isWriteRole(participant.role) && before.diffHash !== task.diffHash) {
      emit({ error: 'Git diff changed after task preparation; prepare the task again.' }, options.json);
      return 1;
    }

    const result = adapter.run({
      workspaceRoot: options.workspace,
      contextPath: paths.context,
      schemaPath,
      timeoutMs: 300000,
    });

    const after = getGitSnapshot(options.workspace);
    if (!isWriteRole(participant.role) && after.diffHash !== task.diffHash) {
      writeNeedsHuman(paths, task, 'Git diff changed while reviewer/verifier was running.', task.reviewCycle);
      emit({ error: 'Git diff changed during review. See REVIEW.json.' }, options.json);
      return 1;
    }

    let parsedResult: any;
    try {
      parsedResult = validateCrewReview(result);
    } catch {
      parsedResult = result;
    }

    if (isWriteRole(participant.role) && after.diffHash !== task.diffHash) {
      task.diffHash = after.diffHash;
      task.changedFiles = after.changedFiles;
      task.updatedAt = new Date().toISOString();
      store.writeTask(task);
      store.writeReady({
        schemaVersion: 1,
        taskId: task.taskId,
        diffHash: after.diffHash,
        createdAt: new Date().toISOString(),
      });
    }

    if (participant.role === 'reviewer' || participant.role === 'verifier') {
      const cycle = (task.reviewCycle ?? 0) + 1;
      task.reviewCycle = cycle;
      task.updatedAt = new Date().toISOString();
      store.writeTask(task);

      const review = {
        schemaVersion: 1,
        taskId: task.taskId,
        diffHash: task.diffHash,
        cycle,
        status: parsedResult.status,
        summary: parsedResult.summary,
        findings: parsedResult.findings,
        reviewedAt: new Date().toISOString(),
      };
      store.writeReview(review);

      if (parsedResult.status === 'pass') {
        try { fs.rmSync(paths.ready, { force: true }); } catch {}
        try { fs.rmSync(paths.needsHuman, { force: true }); } catch {}
      }
      if (parsedResult.status === 'needs_human') {
        writeNeedsHuman(paths, task, parsedResult.summary, cycle, parsedResult.findings);
      }
    }

    const kind = participant.role === 'reviewer' || participant.role === 'verifier'
      ? 'review'
      : participant.role === 'pair'
        ? 'pair-suggest'
        : 'implement';

    const turn = {
      turnId: `turn-${Date.now()}`,
      taskId: task.taskId,
      participantId: options.participant,
      kind,
      status: parsedResult.status,
      summary: parsedResult.summary,
      createdAt: new Date().toISOString(),
    };
    appendTurn(paths, turn);

    emit(result, options.json);
    return 0;
  } finally {
    lock.release();
  }
}
