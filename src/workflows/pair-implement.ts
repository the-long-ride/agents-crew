import type { WorkflowKind } from '../types';
import type { Workflow, WorkflowDecision } from './workflow-registry';

export function createPairImplementWorkflow(): Workflow {
  return {
    kind: 'pair-implement' as WorkflowKind,

    decideNext(input: { task: any; lastTurn: any }): WorkflowDecision {
      const { task, lastTurn } = input;
      const lastParticipant = task.participants.find((p: any) => p.id === lastTurn.participantId);
      const lastRole = lastParticipant?.role;
      const lastStatus = lastTurn.status;
      const implementer = task.participants.find((p: any) => p.role === 'implementer');
      const pair = task.participants.find((p: any) => p.role === 'pair');
      const verifier = task.participants.find((p: any) => p.role === 'verifier');

      if (lastStatus === 'findings' && lastRole === 'pair') {
        return { action: 'needs_human', reason: 'Pair reviewer found conflicts' };
      }

      if (lastRole === 'implementer') {
        return { action: 'continue', nextParticipantId: pair?.id, reason: 'Implementer turn complete, pair review next' };
      }

      if (lastRole === 'pair') {
        if (verifier) {
          return { action: 'continue', nextParticipantId: verifier.id, reason: 'Pair review passed, verifier next' };
        }
        return { action: 'stop', reason: 'All participants passed' };
      }

      if (lastRole === 'verifier') {
        if (lastStatus === 'pass') {
          return { action: 'stop', reason: 'Verification passed' };
        }
        return { action: 'needs_human', reason: 'Verification failed' };
      }

      return { action: 'continue', nextParticipantId: implementer?.id };
    },
  };
}
