export * from './types';
export { validateCrewTaskDraft } from './schema/task';
export { validateCrewReview } from './schema/review';
export { createStatePaths, type StatePaths } from './state/paths';
export { JsonStateStore } from './state/json-store';

export { getGitSnapshot, type GitSnapshot } from './git/snapshot';
export { acquireWorkspaceLock, type WorkspaceLock } from './locks/workspace-lock';

export const packageName = 'agents-crew';
export const packageVersion = '0.0.2';

export type { AgentAdapter, AgentRunInput, AgentRunRequest, AgentRunResult, AgentRunFinding, AgentHookInput, AgentHookDecision } from './adapters/agent-adapter';
export { createProcessAgentAdapter } from './adapters/process-agent';
export { createAntigravityAdapter } from './adapters/antigravity';
export { createCodexAdapter } from './adapters/codex';
export { createClaudeCodeAdapter } from './adapters/claude-code';
export { createOpenCodeAdapter } from './adapters/opencode';
export { createGitHubCopilotAdapter } from './adapters/github-copilot';
export { createAdapter, registerAdapter, getRegisteredAdapters } from './adapters/registry';
export { buildContextPack } from './context/context-pack';
export type { CrewHostPlugin, PluginHost, PluginManifest, PluginInstallTarget, PluginFileResult, PluginDoctorCheck } from './plugins/plugin-contract';
export { getPlugin, getPlugins, PLUGIN_HOSTS } from './plugins/hosts';
export { listPlugins, installPlugins, uninstallPlugins, doctorPlugins } from './plugins/plugin-installer';

export { createWorkflow, registerWorkflow, type Workflow, type WorkflowDecision } from './workflows/workflow-registry';
export { createImplementReviewWorkflow } from './workflows/implement-review';
export { createPairImplementWorkflow } from './workflows/pair-implement';
export { createSameAgentLoopWorkflow } from './workflows/same-agent-loop';
