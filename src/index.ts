export * from './types';
export { validateCrewTaskDraft } from './schema/task';
export { validateCrewReview } from './schema/review';
export { createStatePaths, type StatePaths } from './state/paths';
export { JsonStateStore } from './state/json-store';
export { migrateAgentBridgeV1, type MigrationResult } from './migration/agent-bridge-v1';

export { getGitSnapshot, type GitSnapshot } from './git/snapshot';
export { acquireWorkspaceLock, type WorkspaceLock } from './locks/workspace-lock';

export const packageName = 'agents-crew';
export const packageVersion = '0.1.0';

export type { AgentAdapter, AgentRunInput, AgentRunRequest, AgentRunResult, AgentRunFinding, AgentHookInput, AgentHookDecision } from './adapters/agent-adapter';
export { createProcessAgentAdapter } from './adapters/process-agent';
export { createAntigravityAdapter } from './adapters/antigravity';
export { createCodexAdapter } from './adapters/codex';
export { createClaudeCodeAdapter } from './adapters/claude-code';
export { createOpenCodeAdapter } from './adapters/opencode';
export { createGitHubCopilotAdapter } from './adapters/github-copilot';
export { createAdapter, registerAdapter, getRegisteredAdapters } from './adapters/registry';
export { buildContextPack } from './context/context-pack';

export { createWorkflow, registerWorkflow, type Workflow, type WorkflowDecision } from './workflows/workflow-registry';
export { createImplementReviewWorkflow } from './workflows/implement-review';
export { createPairImplementWorkflow } from './workflows/pair-implement';
export { createSameAgentLoopWorkflow } from './workflows/same-agent-loop';
