import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflow } from '../dist/index.js';

test('same-agent-loop requires distinct participants when agent and role match', () => {
  const workflow = createWorkflow('same-agent-loop');
  const valid = workflow.validateTask({
    participants: [
      { id: 'codex-impl', agent: 'codex', role: 'implementer', conversationId: 'c1', model: 'model-a' },
      { id: 'codex-review', agent: 'codex', role: 'reviewer', conversationId: 'c2', model: 'model-b' },
    ],
  });
  assert.equal(valid.ok, true);

  const invalid = workflow.validateTask({
    participants: [
      { id: 'codex-impl-a', agent: 'codex', role: 'implementer', conversationId: 'same', model: 'model-a' },
      { id: 'codex-impl-b', agent: 'codex', role: 'implementer', conversationId: 'same', model: 'model-a' },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason ?? '', /distinct/i);
});

test('same-agent-loop allows same agent different roles', () => {
  const workflow = createWorkflow('same-agent-loop');
  const valid = workflow.validateTask({
    participants: [
      { id: 'impl', agent: 'codex', role: 'implementer', conversationId: 'same' },
      { id: 'rev', agent: 'codex', role: 'reviewer', conversationId: 'same' },
    ],
  });
  assert.equal(valid.ok, true);
});

test('same-agent-loop allows same agent same role with different model', () => {
  const workflow = createWorkflow('same-agent-loop');
  const valid = workflow.validateTask({
    participants: [
      { id: 'a', agent: 'codex', role: 'implementer', conversationId: 'same', model: 'gpt-4' },
      { id: 'b', agent: 'codex', role: 'implementer', conversationId: 'same', model: 'gpt-3.5' },
    ],
  });
  assert.equal(valid.ok, true);
});

test('same-agent-loop reviewer pass stops', () => {
  const workflow = createWorkflow('same-agent-loop');
  const decision = workflow.decideNext({
    task: { participants: [{ id: 'rev', agent: 'codex', role: 'reviewer' }] },
    lastTurn: { participantId: 'rev', status: 'pass' },
  });
  assert.equal(decision.action, 'stop');
});

test('same-agent-loop reviewer findings route to implementer', () => {
  const workflow = createWorkflow('same-agent-loop');
  const decision = workflow.decideNext({
    task: { participants: [
      { id: 'impl', agent: 'codex', role: 'implementer' },
      { id: 'rev', agent: 'codex', role: 'reviewer' },
    ] },
    lastTurn: { participantId: 'rev', status: 'findings' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'impl');
});

test('same-agent-loop implementer routes to reviewer', () => {
  const workflow = createWorkflow('same-agent-loop');
  const decision = workflow.decideNext({
    task: { participants: [
      { id: 'impl', agent: 'codex', role: 'implementer' },
      { id: 'rev', agent: 'codex', role: 'reviewer' },
    ] },
    lastTurn: { participantId: 'impl', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
  assert.equal(decision.nextParticipantId, 'rev');
});

test('same-agent-loop verifier pass stops', () => {
  const workflow = createWorkflow('same-agent-loop');
  const decision = workflow.decideNext({
    task: { participants: [{ id: 'v', agent: 'codex', role: 'verifier' }] },
    lastTurn: { participantId: 'v', status: 'pass' },
  });
  assert.equal(decision.action, 'stop');
});

test('same-agent-loop duplicate ids rejected', () => {
  const workflow = createWorkflow('same-agent-loop');
  const result = workflow.validateTask({
    participants: [
      { id: 'dup', agent: 'codex', role: 'implementer', conversationId: 'c1' },
      { id: 'dup', agent: 'codex', role: 'reviewer', conversationId: 'c2' },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /distinct/i);
});

test('same-agent-loop unknown role routes to next participant', () => {
  const workflow = createWorkflow('same-agent-loop');
  const decision = workflow.decideNext({
    task: { participants: [
      { id: 'a', agent: 'codex', role: 'implementer' },
      { id: 'b', agent: 'codex', role: 'reviewer' },
    ] },
    lastTurn: { participantId: 'other', status: 'pass' },
  });
  assert.equal(decision.action, 'continue');
});

test('same-agent-loop workflow kind', () => {
  const workflow = createWorkflow('same-agent-loop');
  assert.equal(workflow.kind, 'same-agent-loop');
});

test('createWorkflow throws for unknown kind', () => {
  assert.throws(() => createWorkflow('unknown'), /Unknown workflow/);
});
