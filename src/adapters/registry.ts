import type { AgentKind } from '../types';
import type { AgentAdapter } from './agent-adapter';
import { createProcessAgentAdapter } from './process-agent';
import { createAntigravityAdapter } from './antigravity';
import { createCodexAdapter } from './codex';
import { createClaudeCodeAdapter } from './claude-code';
import { createOpenCodeAdapter } from './opencode';
import { createGitHubCopilotAdapter } from './github-copilot';

type AdapterFactory = (config: unknown) => AgentAdapter;

const registry = new Map<AgentKind, AdapterFactory>();

export function createAdapter(kind: AgentKind, config: unknown = {}): AgentAdapter {
  const factory = registry.get(kind);
  if (!factory) throw new Error(`Unknown adapter: ${kind}`);
  return factory(config);
}

export function registerAdapter(kind: AgentKind, factory: AdapterFactory): void {
  registry.set(kind, factory);
}

export function getRegisteredAdapters(): AgentKind[] {
  return [...registry.keys()];
}

registerAdapter('process', (config: any) => {
  return createProcessAgentAdapter({
    kind: 'process',
    command: config.command ?? 'echo',
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    timeoutMs: config.timeoutMs,
  });
});

registerAdapter('antigravity', (config: any) => createAntigravityAdapter(config));
registerAdapter('codex', (config: any) => createCodexAdapter(config));
registerAdapter('claude-code', (config: any) => createClaudeCodeAdapter(config));
registerAdapter('opencode', (config: any) => createOpenCodeAdapter(config));
registerAdapter('github-copilot', (config: any) => createGitHubCopilotAdapter(config));
