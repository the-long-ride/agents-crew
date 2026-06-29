import fs from 'node:fs';
import { createStatePaths } from './state/paths';
import { JsonStateStore } from './state/json-store';
import { getGitSnapshot } from './git/snapshot';
import { validateCrewReview } from './schema/review';
import { createAdapter } from './adapters/registry';
import { acquireWorkspaceLock } from './locks/workspace-lock';
import { appendTurn, emit, resolveSchemaPath, writeNeedsHuman, atomicWrite } from './cli-utils';

import type { AgentKind } from './types';

const REVIEW_LIMIT = 3;

export function runHook(options: any, paths: any, store: JsonStateStore): number {
  let hookInput: any = {};
  try {
    const stdin = fs.readFileSync(0, 'utf8');
    if (stdin.trim()) hookInput = JSON.parse(stdin);
  } catch {}

  if (fs.existsSync(paths.disabled)) {
    emit({ decision: 'stop', reason: 'Automation is disabled' }, options.json);
    return 0;
  }
  if (!fs.existsSync(paths.ready)) {
    emit({ decision: 'stop', reason: 'No task is marked ready' }, options.json);
    return 0;
  }

  const task = store.readTask() as any;
  const ready = store.readReady() as any;
  if (!task || !ready) {
    emit({ decision: 'stop', reason: 'Task state is incomplete' }, options.json);
    return 0;
  }

  if (ready.taskId !== task.taskId || ready.diffHash !== task.diffHash) {
    emit({ decision: 'stop', reason: 'READY.json does not match TASK.json' }, options.json);
    return 0;
  }

  let lock: any;
  try {
    const adapter = createAdapter(options.adapter, {});
    if (adapter.handleHook) {
      const hookDecision = adapter.handleHook({ task, input: hookInput });
      if (hookDecision.decision !== 'review') {
        emit(hookDecision, options.json);
        return 0;
      }
    }
    lock = acquireWorkspaceLock(paths.lock, task.taskId, `hook-${options.adapter}`);
  } catch (error: any) {
    emit({ decision: 'stop', reason: error.message }, options.json);
    return 0;
  }

  try {
    const before = getGitSnapshot(options.workspace);
    if (before.diffHash !== task.diffHash) {
      writeNeedsHuman(paths, task, 'Git diff changed after task preparation; prepare the task again.', task.reviewCycle);
      emit({ decision: 'stop', reason: 'Git diff changed after task preparation. See REVIEW.json.' }, options.json);
      return 0;
    }

    const reviewer = task.participants?.find((p: any) => p.role === 'reviewer');
    if (!reviewer) {
      emit({ decision: 'stop', reason: 'No reviewer participant found in task' }, options.json);
      return 0;
    }

    const reviewAdapter = createAdapter(reviewer.agent as AgentKind, reviewer);
    const schemaPath = resolveSchemaPath('review.schema.json');
    const reviewResult = reviewAdapter.run({
      workspaceRoot: options.workspace,
      contextPath: paths.context,
      schemaPath,
      timeoutMs: 300000,
    });

    const after = getGitSnapshot(options.workspace);
    if (after.diffHash !== task.diffHash) {
      writeNeedsHuman(paths, task, 'Git diff changed while reviewer was running.', task.reviewCycle);
      emit({ decision: 'stop', reason: 'Git diff changed during review. See REVIEW.json.' }, options.json);
      return 0;
    }

    if (fs.existsSync(paths.disabled)) {
      writeNeedsHuman(paths, task, 'Review completed after automation was disabled; result was cancelled.', task.reviewCycle);
      emit({ decision: 'stop', reason: 'Automation was disabled while review was running.' }, options.json);
      return 0;
    }

    let parsedReview: any;
    try {
      parsedReview = validateCrewReview(reviewResult);
    } catch {
      parsedReview = reviewResult;
    }

    const cycle = task.reviewCycle + 1;
    task.reviewCycle = cycle;
    task.updatedAt = new Date().toISOString();
    store.writeTask(task);

    if (parsedReview.status === 'findings' && cycle >= REVIEW_LIMIT) {
      writeNeedsHuman(paths, task, `Review limit reached. ${parsedReview.summary}`, cycle, parsedReview.findings);
      emit({ decision: 'stop', reason: `Review reached ${REVIEW_LIMIT} cycles. See NEEDS_HUMAN.md.` }, options.json);
      return 0;
    }

    const review = {
      schemaVersion: 1,
      taskId: task.taskId,
      diffHash: task.diffHash,
      cycle,
      status: parsedReview.status,
      summary: parsedReview.summary,
      findings: parsedReview.findings,
      reviewedAt: new Date().toISOString(),
    };
    store.writeReview(review);

    const turn = {
      turnId: `turn-${Date.now()}`,
      taskId: task.taskId,
      participantId: reviewer.id,
      kind: 'review',
      status: review.status,
      summary: review.summary,
      createdAt: new Date().toISOString(),
    };
    appendTurn(paths, turn);

    if (review.status === 'findings') {
      emit(
        { decision: 'continue', reason: `Review cycle ${cycle} found actionable issues. Read REVIEW.json, fix findings, rerun tests, then prepare again.` },
        options.json,
      );
      return 0;
    }

    try { fs.rmSync(paths.ready, { force: true }); } catch {}

    if (review.status === 'needs_human') {
      atomicWrite(
        paths.needsHuman,
        `# Agent Review Needs Human\n\nTask: ${task.taskId}\n\nCycle: ${cycle}\n\n${review.summary}\n`,
      );
      emit({ decision: 'stop', reason: 'Reviewer requested human review. See NEEDS_HUMAN.md.' }, options.json);
      return 0;
    }

    try { fs.rmSync(paths.needsHuman, { force: true }); } catch {}
    emit({ decision: 'stop', reason: 'Review passed.' }, options.json);
    return 0;
  } catch (error: any) {
    const cycle = Math.min(task.reviewCycle + 1, REVIEW_LIMIT);
    writeNeedsHuman(paths, task, `Review failed: ${error.message}`, cycle);
    emit({ decision: 'stop', reason: `Review failed safely. See REVIEW.json.` }, options.json);
    return 0;
  } finally {
    lock.release();
  }
}
