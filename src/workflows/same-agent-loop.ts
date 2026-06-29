import type { WorkflowKind } from '../types';
import type { Workflow, WorkflowDecision } from './workflow-registry';

export function createSameAgentLoopWorkflow(): Workflow {
  return {
    kind: 'same-agent-loop' as WorkflowKind,

    validateTask(input: { participants: any[] }): { ok: boolean; reason?: string } {
      const { participants } = input;
      const ids = new Set(participants.map((p: any) => p.id));
      if (ids.size !== participants.length) {
        return { ok: false, reason: 'Participants must have distinct id' };
      }

      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const a = participants[i];
          const b = participants[j];
          if (a.agent === b.agent && a.role === b.role) {
            const sameConversation = a.conversationId === b.conversationId;
            const sameModel = a.model === b.model;
            if (sameConversation && sameModel) {
              return { ok: false, reason: `Same agent "${a.agent}" with same role "${a.role}" requires distinct conversationId or model` };
            }
          }
        }
      }

      return { ok: true };
    },

    decideNext(input: { task: any; lastTurn: any }): WorkflowDecision {
      const { task, lastTurn } = input;
      const lastParticipant = task.participants.find((p: any) => p.id === lastTurn.participantId);
      const lastRole = lastParticipant?.role;
      const lastStatus = lastTurn.status;

      if (lastRole === 'reviewer' || lastRole === 'verifier') {
        if (lastStatus === 'pass') {
          return { action: 'stop', reason: 'Review passed' };
        }
        if (lastStatus === 'findings') {
          const implementer = task.participants.find((p: any) => p.role === 'implementer');
          return { action: 'continue', nextParticipantId: implementer?.id, reason: 'Findings require fixes' };
        }
      }

      if (lastRole === 'implementer') {
        const reviewer = task.participants.find((p: any) => p.role === 'reviewer');
        return { action: 'continue', nextParticipantId: reviewer?.id, reason: 'Implementation ready for review' };
      }

      const next = task.participants.find((p: any) => p.id !== lastTurn.participantId);
      return { action: 'continue', nextParticipantId: next?.id };
    },
  };
}
