import { createProcessAgentAdapter } from './process-agent';
import type { AgentAdapter } from './agent-adapter';

interface GitHubCopilotConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export function createGitHubCopilotAdapter(config: GitHubCopilotConfig = {}): AgentAdapter {
  return createProcessAgentAdapter({
    kind: 'github-copilot',
    command: config.command ?? 'gh',
    args: config.args,
    env: config.env,
    timeoutMs: config.timeoutMs,
  });
}
