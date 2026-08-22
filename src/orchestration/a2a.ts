import type { AgentInterface, AgentMessage } from '../domain/types.js';

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

function endpointHeaders(endpoint: AgentInterface): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'A2A-Version': endpoint.protocol_version ?? '1.0',
  };
  for (const [name, envName] of Object.entries(endpoint.headers_env ?? {})) {
    const value = process.env[envName];
    if (!value) throw new Error(`missing A2A header environment variable: ${envName}`);
    headers[name] = value;
  }
  return headers;
}

export async function sendA2AMessage(endpoint: AgentInterface, message: AgentMessage): Promise<unknown> {
  if (endpoint.kind !== 'a2a' || !endpoint.url) throw new Error('A2A endpoint is required');
  if ((endpoint.protocol_binding ?? 'JSONRPC') !== 'JSONRPC') throw new Error(`unsupported A2A binding: ${endpoint.protocol_binding}`);
  const body = {
    jsonrpc: '2.0',
    id: message.id,
    method: 'message/send',
    params: {
      message: {
        role: 'ROLE_USER',
        parts: [{ text: message.body }],
        messageId: message.id,
        ...(message.task_id ? { taskId: message.task_id } : {}),
      },
      metadata: {
        agentsCrew: {
          runId: message.run_id,
          from: message.from,
          to: message.to,
          kind: message.kind,
          ...(message.reply_to ? { replyTo: message.reply_to } : {}),
        },
      },
    },
  };
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: endpointHeaders(endpoint),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`A2A request failed: HTTP ${response.status}`);
  const payload = await response.json() as JsonRpcResponse;
  if (payload.error) throw new Error(`A2A error ${payload.error.code ?? 'unknown'}: ${payload.error.message ?? 'request failed'}`);
  if (payload.jsonrpc !== '2.0') throw new Error('invalid A2A JSON-RPC response');
  return payload.result;
}
