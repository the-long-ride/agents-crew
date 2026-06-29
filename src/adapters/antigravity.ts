import type { AgentAdapter, AgentHookDecision, AgentRunInput, AgentRunRequest, AgentRunResult } from './agent-adapter';

interface AntigravityConfig {
  conversationId?: string;
}

export function createAntigravityAdapter(_config: AntigravityConfig = {}): AgentAdapter {
  return {
    kind: 'antigravity' as const,

    validateConfig(_config: unknown) {},

    buildRunRequest(_input: AgentRunInput): AgentRunRequest {
      return {
        command: '',
        args: [],
        timeoutMs: 0,
      };
    },

    run(_input: AgentRunInput): AgentRunResult {
      throw new Error('Antigravity adapter is hook-based, use handleHook instead');
    },

    parseRunResult(_output: string): AgentRunResult {
      throw new Error('Not supported');
    },

    handleHook(input: { task: { conversationId?: string }; input: { fullyIdle: boolean; terminationReason: string; conversationId: string } }): AgentHookDecision {
      if (input.input.fullyIdle !== true) {
        return { decision: 'stop', reason: 'Antigravity still has active work.' };
      }
      if (input.input.terminationReason !== 'model_stop') {
        return { decision: 'stop', reason: `Review skipped for termination reason: ${input.input.terminationReason || 'unknown'}.` };
      }
      if (input.input.conversationId && input.task.conversationId && input.input.conversationId !== input.task.conversationId) {
        throw new Error('Agent conversation does not match TASK.json');
      }
      return { decision: 'review' };
    },
  };
}
