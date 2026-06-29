import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflow, createImplementReviewWorkflow } from '../dist/index.js';

const participants = [
  { id: 'impl', role: 'implementer', agent: 'antigravity' },
  { id: 'review', role: 'reviewer', agent: 'codex' },
];

test('implement-review sends findings back to implementer', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 1, participants },
    lastTurn: { participantId: 'review', status: 'findings' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'impl');
});

test('implement-review pass stops loop', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 1, participants },
    lastTurn: { participantId: 'review', status: 'pass' },
  });
  assert.equal(decision.action, 'stop');
});

test('implement-review needs_human from reviewer', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 1, participants },
    lastTurn: { participantId: 'review', status: 'needs_human' },
  });
  assert.equal(decision.action, 'needs_human');
});

test('implement-review returns needs_human when review limit reached', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 3, participants },
    lastTurn: { participantId: 'review', status: 'findings' },
  });
  assert.equal(decision.action, 'needs_human');
  assert.match(decision.reason ?? '', /limit/i);
});

test('implement-review implementer turn routes to reviewer', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 0, participants },
    lastTurn: { participantId: 'impl', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'review');
});

test('implement-review custom review limit', () => {
  const workflow = createImplementReviewWorkflow(5);
  const decision = workflow.decideNext({
    task: { reviewCycle: 4, participants },
    lastTurn: { participantId: 'review', status: 'findings' },
  });
  assert.equal(decision.action, 'continue');
  const limited = workflow.decideNext({
    task: { reviewCycle: 5, participants },
    lastTurn: { participantId: 'review', status: 'findings' },
  });
  assert.equal(limited.action, 'needs_human');
});

test('implement-review unknown role routes to reviewer', () => {
  const workflow = createWorkflow('implement-review');
  const decision = workflow.decideNext({
    task: { reviewCycle: 0, participants },
    lastTurn: { participantId: 'unknown', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'review');
});

test('implement-review workflow kind', () => {
  const workflow = createWorkflow('implement-review');
  assert.equal(workflow.kind, 'implement-review');
});
