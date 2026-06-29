import { createProcessAgentAdapter } from './process-agent';
import type { AgentAdapter } from './agent-adapter';

interface ClaudeCodeConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export function createClaudeCodeAdapter(config: ClaudeCodeConfig = {}): AgentAdapter {
  return createProcessAgentAdapter({
    kind: 'claude-code',
    command: config.command ?? 'claude',
    args: config.args,
    env: config.env,
    timeoutMs: config.timeoutMs,
  });
}
