import { spawnSync } from 'node:child_process';
import type { AgentKind } from '../types';
import type { AgentAdapter, AgentRunInput, AgentRunRequest, AgentRunResult } from './agent-adapter';
import { validateCrewReview } from '../schema/review';

interface ProcessAdapterConfig {
  kind: AgentKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export function createProcessAgentAdapter(config: ProcessAdapterConfig): AgentAdapter {
  return {
    kind: config.kind,

    validateConfig(_config: unknown) {},

    buildRunRequest(input: AgentRunInput): AgentRunRequest {
      return {
        command: config.command,
        args: [...(config.args ?? []), '--context', input.contextPath, '--schema', input.schemaPath],
        env: config.env,
        cwd: config.cwd ?? input.workspaceRoot,
        timeoutMs: config.timeoutMs ?? input.timeoutMs,
      };
    },

    run(input: AgentRunInput): AgentRunResult {
      const request = this.buildRunRequest(input);
      const result = spawnSync(request.command, request.args, {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        timeout: request.timeoutMs,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });

      if (result.error) {
        if ((result.error as any).code === 'ETIMEDOUT') {
          return { status: 'needs_human', summary: `Process timed out after ${request.timeoutMs}ms`, findings: [] };
        }
        return { status: 'needs_human', summary: result.error.message, findings: [] };
      }

      if (result.status !== 0) {
        return { status: 'needs_human', summary: `Process exited with status ${result.status}: ${String(result.stderr).trim()}`, findings: [] };
      }

      return this.parseRunResult(result.stdout);
    },

    parseRunResult(output: string): AgentRunResult {
      const lines = output.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      try {
        const parsed = JSON.parse(lastLine);
        return validateCrewReview(parsed) as unknown as AgentRunResult;
      } catch {
        return { status: 'needs_human', summary: 'Failed to parse process output as review JSON', findings: [] };
      }
    },
  };
}
