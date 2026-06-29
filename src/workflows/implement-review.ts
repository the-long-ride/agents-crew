import type { WorkflowKind } from '../types';
import type { Workflow, WorkflowDecision } from './workflow-registry';

const DEFAULT_REVIEW_LIMIT = 3;

export function createImplementReviewWorkflow(reviewLimit = DEFAULT_REVIEW_LIMIT): Workflow {
  return {
    kind: 'implement-review' as WorkflowKind,

    decideNext(input: { task: any; lastTurn: any }): WorkflowDecision {
      const { task, lastTurn } = input;
      const lastStatus = lastTurn.status;
      const lastRole = task.participants.find((p: any) => p.id === lastTurn.participantId)?.role;
      const implementer = task.participants.find((p: any) => p.role === 'implementer');
      const reviewer = task.participants.find((p: any) => p.role === 'reviewer');

      if (lastRole === 'reviewer') {
        if (lastStatus === 'pass') {
          return { action: 'stop', reason: 'Review passed' };
        }
        if (lastStatus === 'findings') {
          const cycle = task.reviewCycle ?? 0;
          if (cycle >= reviewLimit) {
            return { action: 'needs_human', reason: 'Review limit reached' };
          }
          return { action: 'continue', nextParticipantId: implementer?.id, reason: 'Findings require fixes' };
        }
        if (lastStatus === 'needs_human') {
          return { action: 'needs_human', reason: lastTurn.summary ?? 'Review needs human' };
        }
      }

      if (lastRole === 'implementer') {
        return { action: 'continue', nextParticipantId: reviewer?.id, reason: 'Implementation ready for review' };
      }

      return { action: 'continue', nextParticipantId: reviewer?.id };
    },
  };
}
