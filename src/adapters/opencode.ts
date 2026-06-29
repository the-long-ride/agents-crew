import { createProcessAgentAdapter } from './process-agent';
import type { AgentAdapter } from './agent-adapter';

interface OpenCodeConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export function createOpenCodeAdapter(config: OpenCodeConfig = {}): AgentAdapter {
  return createProcessAgentAdapter({
    kind: 'opencode',
    command: config.command ?? 'opencode',
    args: config.args,
    env: config.env,
    timeoutMs: config.timeoutMs,
  });
}
