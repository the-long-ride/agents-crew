import type { AgentKind, CrewReviewStatus, CrewSeverity } from '../types';

export interface AgentRunInput {
  workspaceRoot: string;
  contextPath: string;
  schemaPath: string;
  timeoutMs: number;
}

export interface AgentRunRequest {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface AgentRunResult {
  status: CrewReviewStatus;
  summary: string;
  findings: AgentRunFinding[];
}

export interface AgentRunFinding {
  severity: CrewSeverity;
  file: string;
  line: number;
  title: string;
  evidence: string;
  requiredFix: string;
}

export interface AgentHookInput {
  fullyIdle: boolean;
  terminationReason: string;
  conversationId: string;
}

export interface AgentHookDecision {
  decision: 'review' | 'skip' | 'stop';
  reason?: string;
}

export interface AgentAdapter {
  readonly kind: AgentKind;
  validateConfig(config: unknown): void;
  buildRunRequest(input: AgentRunInput): AgentRunRequest;
  run(input: AgentRunInput): AgentRunResult;
  parseRunResult(output: string): AgentRunResult;
  handleHook?(input: { task: { conversationId?: string }; input: AgentHookInput }): AgentHookDecision;
}
