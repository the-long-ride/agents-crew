import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflow } from '../dist/index.js';

const participants = [
  { id: 'a', role: 'implementer', agent: 'claude-code' },
  { id: 'b', role: 'pair', agent: 'codex' },
  { id: 'v', role: 'verifier', agent: 'opencode' },
];

test('pair-implement implementer routes to pair', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'a', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'b');
});

test('pair-implement pair routes to verifier', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'b', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'v');
});

test('pair-implement pair without verifier stops', () => {
  const noVerifier = [
    { id: 'a', role: 'implementer', agent: 'claude-code' },
    { id: 'b', role: 'pair', agent: 'codex' },
  ];
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants: noVerifier },
    lastTurn: { participantId: 'b', status: 'pass' },
  });
  assert.equal(decision.action, 'stop');
});

test('pair-implement verifier pass stops', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'v', status: 'pass' },
  });
  assert.equal(decision.action, 'stop');
});

test('pair-implement verifier fail needs human', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'v', status: 'failed' },
  });
  assert.equal(decision.action, 'needs_human');
});

test('pair-implement pair findings need human', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'b', status: 'findings' },
  });
  assert.equal(decision.action, 'needs_human');
  assert.match(decision.reason ?? '', /conflict/i);
});

test('pair-implement unknown role routes to implementer', () => {
  const workflow = createWorkflow('pair-implement');
  const decision = workflow.decideNext({
    task: { participants },
    lastTurn: { participantId: 'x', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'a');
});

test('pair-implement workflow kind', () => {
  const workflow = createWorkflow('pair-implement');
  assert.equal(workflow.kind, 'pair-implement');
});
