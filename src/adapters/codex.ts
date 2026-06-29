import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter, AgentRunInput, AgentRunRequest, AgentRunResult } from './agent-adapter';
import { validateCrewReview } from '../schema/review';

interface CodexConfig {
  command?: string;
  prefixArgs?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}

export function createCodexAdapter(config: CodexConfig = {}): AgentAdapter {
  const command = config.command ?? 'codex';

  return {
    kind: 'codex' as const,

    validateConfig(_config: unknown) {},

    buildRunRequest(input: AgentRunInput): AgentRunRequest {
      const outputPath = join(input.workspaceRoot, `.agents-crew/codex-result-${process.pid}.json`);
      const prompt = [
        'Review the current working-tree changes. Do not edit any file.',
        `Read task context from ${input.contextPath}.`,
        'Read repository AGENTS.md and relevant nested instructions.',
        'Inspect the live Git diff, affected callers, tests, and error paths.',
        'Report only actionable correctness, security, regression, or missing-test findings.',
        'Return output matching the supplied JSON schema.',
      ].join('\n');

      return {
        command,
        args: [
          ...(config.prefixArgs ?? []),
          'exec',
          '--sandbox', 'read-only',
          '--output-schema', input.schemaPath,
          '--output-last-message', outputPath,
          prompt,
        ],
        env: config.env,
        cwd: input.workspaceRoot,
        timeoutMs: config.timeoutMs ?? input.timeoutMs,
      };
    },

    run(input: AgentRunInput): AgentRunResult {
      const request = this.buildRunRequest(input);
      const outputPath = request.args[request.args.indexOf('--output-last-message') + 1];

      try {
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
            return { status: 'needs_human', summary: `Codex review timed out after ${request.timeoutMs}ms`, findings: [] };
          }
          return { status: 'needs_human', summary: result.error.message, findings: [] };
        }

        if (result.status !== 0) {
          return { status: 'needs_human', summary: `Codex exited with status ${result.status}: ${String(result.stderr).trim()}`, findings: [] };
        }

        return this.parseRunResult(readFileSync(outputPath, 'utf8'));
      } finally {
        try { rmSync(outputPath, { force: true }); } catch {}
      }
    },

    parseRunResult(output: string): AgentRunResult {
      try {
        const parsed = JSON.parse(output.trim());
        return validateCrewReview(parsed) as unknown as AgentRunResult;
      } catch {
        return { status: 'needs_human', summary: 'Failed to parse codex output as review JSON', findings: [] };
      }
    },
  };
}
