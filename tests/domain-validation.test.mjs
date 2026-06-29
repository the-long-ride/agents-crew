import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCrewTaskDraft, validateCrewReview } from '../dist/index.js';

const validTaskDraft = {
  taskId: 'task-1',
  goal: 'Add adapter',
  acceptanceCriteria: ['Adapter can run'],
  tests: [{ command: 'npm test', status: 'passed', summary: 'all pass' }],
  implementationSummary: 'Added adapter',
  workflow: 'implement-review',
  participants: [
    { id: 'antigravity-impl', agent: 'antigravity', role: 'implementer' },
    { id: 'codex-review', agent: 'codex', role: 'reviewer' },
  ],
};

test('validates crew task draft with participants and workflow', () => {
  const task = validateCrewTaskDraft(validTaskDraft);
  assert.equal(task.workflow, 'implement-review');
  assert.equal(task.participants.length, 2);
});

test('validates all workflow kinds', () => {
  for (const workflow of ['implement-review', 'pair-implement', 'same-agent-loop']) {
    const task = validateCrewTaskDraft({ ...validTaskDraft, workflow });
    assert.equal(task.workflow, workflow);
  }
});

test('validates all agent kinds', () => {
  for (const agent of ['antigravity', 'codex', 'claude-code', 'opencode', 'github-copilot', 'process']) {
    const task = validateCrewTaskDraft({
      ...validTaskDraft,
      participants: [{ id: `${agent}-1`, agent, role: 'implementer' }],
    });
    assert.equal(task.participants[0].agent, agent);
  }
});

test('validates all crew roles', () => {
  for (const role of ['implementer', 'reviewer', 'pair', 'verifier']) {
    const task = validateCrewTaskDraft({
      ...validTaskDraft,
      participants: [{ id: `p-${role}`, agent: 'codex', role }],
    });
    assert.equal(task.participants[0].role, role);
  }
});

test('validates all test statuses', () => {
  for (const status of ['passed', 'failed', 'skipped', 'blocked']) {
    const task = validateCrewTaskDraft({
      ...validTaskDraft,
      tests: [{ command: 'npm test', status, summary: 'result' }],
    });
    assert.equal(task.tests[0].status, status);
  }
});

test('preserves optional conversationId', () => {
  const task = validateCrewTaskDraft({ ...validTaskDraft, conversationId: 'conv-1' });
  assert.equal(task.conversationId, 'conv-1');
});

test('task without conversationId omits it', () => {
  const task = validateCrewTaskDraft(validTaskDraft);
  assert.equal(task.conversationId, undefined);
});

test('normalizes antigravityConversationId to conversationId', () => {
  const draft = { ...validTaskDraft };
  delete draft.conversationId;
  draft.antigravityConversationId = 'legacy-conv';
  const task = validateCrewTaskDraft(draft);
  assert.equal(task.conversationId, 'legacy-conv');
});

test('rejects task without participants', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [] }),
    /participants/,
  );
});

test('rejects task with missing taskId', () => {
  const { taskId, ...noId } = validTaskDraft;
  assert.throws(() => validateCrewTaskDraft(noId), /taskId/);
});

test('rejects task with empty taskId', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, taskId: '' }), /taskId/);
});

test('rejects task with missing goal', () => {
  const { goal, ...noGoal } = validTaskDraft;
  assert.throws(() => validateCrewTaskDraft(noGoal), /goal/);
});

test('rejects task with empty goal', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, goal: '' }), /goal/);
});

test('rejects task with empty acceptanceCriteria', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, acceptanceCriteria: [] }), /acceptanceCriteria/);
});

test('rejects task with non-string acceptanceCriteria', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, acceptanceCriteria: [123] }), /acceptanceCriteria/);
});

test('rejects task with missing implementationSummary', () => {
  const { implementationSummary, ...noSummary } = validTaskDraft;
  assert.throws(() => validateCrewTaskDraft(noSummary), /implementationSummary/);
});

test('rejects task with invalid workflow', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, workflow: 'invalid' }), /workflow/);
});

test('rejects task with invalid participant agent', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'invalid', role: 'implementer' }] }),
    /participant/,
  );
});

test('rejects task with invalid participant role', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'codex', role: 'invalid' }] }),
    /participant/,
  );
});

test('rejects task with missing participant id', () => {
    assert.throws(
      () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ agent: 'codex', role: 'reviewer' }] }),
      /participant/,
    );
  });

test('rejects participant with invalid command type', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'process', role: 'reviewer', command: 42 }] }),
    /participant/,
  );
});

test('rejects participant with empty command', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'process', role: 'reviewer', command: '' }] }),
    /participant/,
  );
});

test('rejects participant with non-string args', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'process', role: 'reviewer', command: 'x', args: 'y' }] }),
    /participant/,
  );
});

test('rejects participant with non-string env values', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'process', role: 'reviewer', command: 'x', env: { KEY: 123 } }] }),
    /participant/,
  );
});

test('rejects participant with array env', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'process', role: 'reviewer', command: 'x', env: [] }] }),
    /participant/,
  );
});

test('rejects participant with invalid model', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, participants: [{ id: 'p1', agent: 'codex', role: 'reviewer', model: 42 }] }),
    /participant/,
  );
});

test('accepts participant with valid optional fields', () => {
  const task = validateCrewTaskDraft({
    ...validTaskDraft,
    participants: [{
      id: 'p1', agent: 'process', role: 'reviewer',
      command: 'node', args: ['review.cjs'], env: { KEY: 'val' }, cwd: '/tmp', model: 'gpt-4',
    }],
  });
  assert.equal(task.participants[0].command, 'node');
  assert.deepEqual(task.participants[0].args, ['review.cjs']);
  assert.deepEqual(task.participants[0].env, { KEY: 'val' });
});

test('rejects task with invalid test object', () => {
  assert.throws(
    () => validateCrewTaskDraft({ ...validTaskDraft, tests: [{ command: '', status: 'passed', summary: 'ok' }] }),
    /test/,
  );
});

test('rejects non-object input', () => {
  assert.throws(() => validateCrewTaskDraft(null), /object/);
});

test('rejects task with non-array tests', () => {
  assert.throws(() => validateCrewTaskDraft({ ...validTaskDraft, tests: 'bad' }), /tests/);
});

test('validates review findings shape', () => {
  const review = validateCrewReview({
    status: 'findings',
    summary: 'One issue',
    findings: [{
      severity: 'high',
      file: 'src/index.ts',
      line: 1,
      title: 'Wrong export',
      evidence: 'Export missing',
      requiredFix: 'Export symbol',
    }],
  });
  assert.equal(review.status, 'findings');
});

test('validates pass review with no findings', () => {
  const review = validateCrewReview({ status: 'pass', summary: 'Clean', findings: [] });
  assert.equal(review.status, 'pass');
});

test('validates needs_human review', () => {
  const review = validateCrewReview({ status: 'needs_human', summary: 'Escalate', findings: [] });
  assert.equal(review.status, 'needs_human');
});

test('validates all severities in findings', () => {
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const review = validateCrewReview({
      status: 'findings',
      summary: 'Issue',
      findings: [{ severity, file: 'f.ts', line: 1, title: 'T', evidence: 'E', requiredFix: 'F' }],
    });
    assert.equal(review.findings[0].severity, severity);
  }
});

test('rejects review with invalid status', () => {
  assert.throws(() => validateCrewReview({ status: 'invalid', summary: 's', findings: [] }), /status/);
});

test('rejects pass review with findings', () => {
  assert.throws(() => validateCrewReview({
    status: 'pass',
    summary: 's',
    findings: [{ severity: 'high', file: 'f', line: 1, title: 't', evidence: 'e', requiredFix: 'f' }],
  }), /pass/);
});

test('rejects findings review with empty findings', () => {
  assert.throws(() => validateCrewReview({ status: 'findings', summary: 's', findings: [] }), /findings/);
});

test('rejects review with empty summary', () => {
  assert.throws(() => validateCrewReview({ status: 'pass', summary: '', findings: [] }), /summary/);
});

test('rejects non-object review', () => {
  assert.throws(() => validateCrewReview('bad'), /object/);
});

test('rejects finding with invalid line', () => {
  assert.throws(
    () => validateCrewReview({
      status: 'findings', summary: 's',
      findings: [{ severity: 'high', file: 'f', line: 0, title: 't', evidence: 'e', requiredFix: 'f' }],
    }),
    /finding/,
  );
});

test('rejects finding with missing required fields', () => {
  assert.throws(
    () => validateCrewReview({
      status: 'findings', summary: 's',
      findings: [{ severity: 'high', file: 'f', line: 1 }],
    }),
    /finding/,
  );
});
