export type AgentKind =
  | 'antigravity'
  | 'codex'
  | 'claude-code'
  | 'opencode'
  | 'github-copilot'
  | 'process';

export type WorkflowKind =
  | 'implement-review'
  | 'pair-implement'
  | 'same-agent-loop';

export type CrewRole = 'implementer' | 'reviewer' | 'pair' | 'verifier';
export type CrewTestStatus = 'passed' | 'failed' | 'skipped' | 'blocked';
export type CrewReviewStatus = 'pass' | 'findings' | 'needs_human';
export type CrewSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CrewTestResult {
  command: string;
  status: CrewTestStatus;
  summary: string;
}

export interface CrewParticipant {
  id: string;
  agent: AgentKind;
  role: CrewRole;
  model?: string;
  conversationId?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface CrewTaskDraft {
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  tests: CrewTestResult[];
  implementationSummary: string;
  workflow: WorkflowKind;
  participants: CrewParticipant[];
  conversationId?: string;
}

export interface CrewFinding {
  severity: CrewSeverity;
  file: string;
  line: number;
  title: string;
  evidence: string;
  requiredFix: string;
}

export interface CrewReview {
  status: CrewReviewStatus;
  summary: string;
  findings: CrewFinding[];
}
