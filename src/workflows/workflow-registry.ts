import type { WorkflowKind } from '../types';

export interface WorkflowDecision {
  action: 'stop' | 'continue' | 'needs_human';
  nextParticipantId?: string;
  reason?: string;
}

export interface Workflow {
  readonly kind: WorkflowKind;
  decideNext(input: { task: any; lastTurn: any }): WorkflowDecision;
  validateTask?(input: { participants: any[] }): { ok: boolean; reason?: string };
}

const registry = new Map<WorkflowKind, () => Workflow>();

export function createWorkflow(kind: WorkflowKind): Workflow {
  const factory = registry.get(kind);
  if (!factory) throw new Error(`Unknown workflow: ${kind}`);
  return factory();
}

export function registerWorkflow(kind: WorkflowKind, factory: () => Workflow): void {
  registry.set(kind, factory);
}

import { createImplementReviewWorkflow } from './implement-review';
import { createPairImplementWorkflow } from './pair-implement';
import { createSameAgentLoopWorkflow } from './same-agent-loop';

registerWorkflow('implement-review', () => createImplementReviewWorkflow());
registerWorkflow('pair-implement', () => createPairImplementWorkflow());
registerWorkflow('same-agent-loop', () => createSameAgentLoopWorkflow());
