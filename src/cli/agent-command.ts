import { resolve } from 'node:path';
import type { ParsedArgs } from './args.js';
import type { AgentMessageKind, Capability, Role } from '../domain/types.js';
import { AgentMesh } from '../orchestration/agent-mesh.js';

export const agentOperations = ['register', 'list', 'heartbeat', 'claim', 'release', 'send', 'inbox', 'capabilities'] as const;

const messageKinds = new Set<AgentMessageKind>(['message', 'request', 'response', 'review', 'blocker']);

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positional(args: Record<string, unknown>): string[] {
  return Array.isArray(args.positional) ? args.positional.map(String) : [];
}

function csv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function messageKind(value: unknown): AgentMessageKind {
  const kind = optionalText(value) ?? 'message';
  if (!messageKinds.has(kind as AgentMessageKind)) throw new Error(`invalid message kind: ${kind}`);
  return kind as AgentMessageKind;
}

export function agentCapabilities(): unknown {
  return {
    protocol: 'agents-crew-agent-mesh/1',
    a2a: '1.0',
    operations: [...agentOperations],
    transport: { direct: 'a2a-jsonrpc', fallback: 'durable-mailbox' },
  };
}

export async function dispatchAgentCommand(parsed: ParsedArgs): Promise<unknown> {
  if (parsed.command !== 'agent') throw new Error(`agent dispatcher cannot handle command: ${parsed.command}`);
  const workspace = resolve(parsed.workspace);
  const { args } = parsed;
  const subcommand = text(args.subcommand, 'agent subcommand');
  const values = positional(args);
  const mesh = new AgentMesh(workspace);

  if (subcommand === 'capabilities') return agentCapabilities();
  if (subcommand === 'list') return { agents: await mesh.listAgents() };
  if (subcommand === 'register') {
    const id = text(values[0], 'agent id');
    const a2aUrl = optionalText(args.a2a_url);
    const interfaces = a2aUrl ? [{ kind: 'a2a' as const, url: a2aUrl, protocol_binding: 'JSONRPC' as const, protocol_version: optionalText(args.a2a_version) ?? '1.0' }] : [];
    return {
      agent: await mesh.register({
        id,
        provider: optionalText(args.provider),
        roles: csv(args.roles) as Role[],
        capabilities: csv(args.capabilities) as Capability[],
        interfaces,
      }),
    };
  }
  if (subcommand === 'heartbeat') return { agent: await mesh.heartbeat(text(values[0], 'agent id')) };
  if (subcommand === 'claim') {
    const leaseSeconds = Number(args.lease_seconds ?? 300);
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 0) throw new Error('lease seconds must be a non-negative number');
    return { lease: await mesh.claimTask(text(values[0], 'run id'), text(values[1], 'task id'), text(values[2], 'agent id'), leaseSeconds) };
  }
  if (subcommand === 'release') {
    const runId = text(values[0], 'run id');
    const taskId = text(values[1], 'task id');
    const agentId = text(values[2], 'agent id');
    await mesh.releaseTask(runId, taskId, agentId, args.force === true);
    return { run_id: runId, task_id: taskId, agent_id: agentId, released: true };
  }
  if (subcommand === 'send') {
    return {
      message: await mesh.sendMessage(text(values[0], 'run id'), {
        from: text(values[1], 'sender agent id'),
        to: text(values[2], 'recipient agent id'),
        kind: messageKind(args.kind),
        body: text(args.body, 'message body'),
        task_id: optionalText(args.task),
        reply_to: optionalText(args.reply_to),
      }),
    };
  }
  if (subcommand === 'inbox') return { messages: await mesh.inbox(text(values[0], 'run id'), text(values[1], 'agent id')) };
  throw new Error(`unknown agent subcommand: ${subcommand}`);
}
