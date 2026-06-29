import type {
  AgentKind,
  CrewRole,
  CrewTaskDraft,
  CrewParticipant,
  CrewTestResult,
  CrewTestStatus,
  WorkflowKind,
} from '../types';

const AGENT_KINDS: readonly AgentKind[] = [
  'antigravity',
  'codex',
  'claude-code',
  'opencode',
  'github-copilot',
  'process',
];

const CREW_ROLES: readonly CrewRole[] = ['implementer', 'reviewer', 'pair', 'verifier'];

const TEST_STATUSES: readonly CrewTestStatus[] = ['passed', 'failed', 'skipped', 'blocked'];

const WORKFLOW_KINDS: readonly WorkflowKind[] = [
  'implement-review',
  'pair-implement',
  'same-agent-loop',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

function isCrewTestResult(value: unknown): value is CrewTestResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isNonEmptyString(obj.command) &&
    TEST_STATUSES.includes(obj.status as CrewTestStatus) &&
    typeof obj.summary === 'string'
  );
}

function isCrewParticipant(value: unknown): value is CrewParticipant {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!isNonEmptyString(obj.id)) return false;
  if (!AGENT_KINDS.includes(obj.agent as AgentKind)) return false;
  if (!CREW_ROLES.includes(obj.role as CrewRole)) return false;
  if (obj.model !== undefined && !isNonEmptyString(obj.model)) return false;
  if (obj.conversationId !== undefined && !isNonEmptyString(obj.conversationId)) return false;
  if (obj.command !== undefined && !isNonEmptyString(obj.command)) return false;
  if (obj.cwd !== undefined && !isNonEmptyString(obj.cwd)) return false;
  if (obj.args !== undefined && !isStringArray(obj.args)) return false;
  if (obj.env !== undefined && !isStringRecord(obj.env)) return false;
  if (obj.timeoutMs !== undefined && typeof obj.timeoutMs !== 'number') return false;
  return true;
}

export function validateCrewTaskDraft(input: unknown): CrewTaskDraft {
  if (typeof input !== 'object' || input === null) {
    throw new Error('CrewTaskDraft must be an object');
  }

  const obj = input as Record<string, unknown>;

  if (!isNonEmptyString(obj.taskId)) {
    throw new Error('taskId must be a non-empty string');
  }

  if (!isNonEmptyString(obj.goal)) {
    throw new Error('goal must be a non-empty string');
  }

  if (!Array.isArray(obj.acceptanceCriteria) || obj.acceptanceCriteria.length === 0) {
    throw new Error('acceptanceCriteria must be a non-empty array');
  }

  for (const criterion of obj.acceptanceCriteria) {
    if (typeof criterion !== 'string') {
      throw new Error('acceptanceCriteria must contain only strings');
    }
  }

  if (!Array.isArray(obj.tests)) {
    throw new Error('tests must be an array');
  }

  for (const test of obj.tests) {
    if (!isCrewTestResult(test)) {
      throw new Error('each test must have a valid command, status, and summary');
    }
  }

  if (!isNonEmptyString(obj.implementationSummary)) {
    throw new Error('implementationSummary must be a non-empty string');
  }

  if (!WORKFLOW_KINDS.includes(obj.workflow as WorkflowKind)) {
    throw new Error('workflow must be a valid WorkflowKind');
  }

  if (!Array.isArray(obj.participants) || obj.participants.length === 0) {
    throw new Error('participants must be a non-empty array');
  }

  for (const participant of obj.participants) {
    if (!isCrewParticipant(participant)) {
      throw new Error('each participant must have valid id, agent, and role');
    }
  }

  const conversationId = (obj.conversationId ?? obj.antigravityConversationId) as string | undefined;
  if (conversationId !== undefined && !isNonEmptyString(conversationId)) {
    throw new Error('conversationId must be a non-empty string when provided');
  }

  return {
    taskId: obj.taskId,
    goal: obj.goal,
    acceptanceCriteria: obj.acceptanceCriteria as string[],
    tests: obj.tests as CrewTestResult[],
    implementationSummary: obj.implementationSummary,
    workflow: obj.workflow as WorkflowKind,
    participants: obj.participants as CrewParticipant[],
    conversationId,
  };
}
