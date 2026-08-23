import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRegistration, AgentRegistrationInput, Capability, Role } from '../domain/types.js';
import { atomicJson, withDirectoryLock } from '../shared/durable-fs.js';

const roles = new Set<Role>(['manager', 'planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator']);
const capabilities = new Set<Capability>(['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive']);

export function assertAgentId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`invalid agent identifier: ${value}`);
  }
}

function validateRegistration(input: AgentRegistrationInput): void {
  assertAgentId(input.id);
  if (!Array.isArray(input.roles) || input.roles.some((role) => !roles.has(role))) throw new Error('invalid agent roles');
  if (!Array.isArray(input.capabilities) || input.capabilities.some((capability) => !capabilities.has(capability))) {
    throw new Error('invalid agent capabilities');
  }
  if (!Array.isArray(input.interfaces)) throw new Error('invalid agent interfaces');
  for (const endpoint of input.interfaces) {
    if (!endpoint || !['a2a', 'mailbox'].includes(endpoint.kind)) throw new Error('invalid agent interface');
    if (endpoint.kind !== 'a2a') continue;
    if (!endpoint.url) throw new Error('a2a interface url is required');
    const protocol = new URL(endpoint.url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error('a2a interface must use http or https');
    const binding = endpoint.protocol_binding ?? 'JSONRPC';
    if (binding !== 'JSONRPC') throw new Error(`unsupported A2A binding: ${binding}`);
    const version = endpoint.protocol_version ?? '1.0';
    if (version !== '1.0') throw new Error(`unsupported A2A protocol version: ${version}`);
    if (endpoint.tenant !== undefined && !endpoint.tenant.trim()) throw new Error('a2a tenant must be non-empty');
    if (endpoint.headers_env && Object.values(endpoint.headers_env).some((name) => !name.trim())) {
      throw new Error('a2a header env names must be non-empty');
    }
  }
}

function parseRegistration(raw: string, expectedId: string): AgentRegistration {
  const value = JSON.parse(raw) as AgentRegistration;
  if (!value || typeof value !== 'object' || value.id !== expectedId
    || typeof value.registered_at !== 'string' || typeof value.heartbeat_at !== 'string') {
    throw new Error(`invalid agent registration: ${expectedId}`);
  }
  validateRegistration(value);
  return value;
}

export class AgentRegistry {
  readonly root: string;

  constructor(readonly workspace: string) {
    this.root = join(workspace, '.agents-crew', 'agents');
  }

  private path(id: string): string {
    assertAgentId(id);
    return join(this.root, `${id}.json`);
  }

  async load(id: string): Promise<AgentRegistration> {
    const path = this.path(id);
    if (!existsSync(path)) throw new Error(`agent not found: ${id}`);
    return parseRegistration(await readFile(path, 'utf8'), id);
  }

  async register(input: AgentRegistrationInput): Promise<AgentRegistration> {
    validateRegistration(input);
    const path = this.path(input.id);
    return withDirectoryLock(`${path}.lock`, async () => {
      const now = new Date().toISOString();
      const previous = existsSync(path) ? parseRegistration(await readFile(path, 'utf8'), input.id) : undefined;
      const registration: AgentRegistration = {
        ...structuredClone(input),
        metadata: structuredClone(input.metadata ?? {}),
        interfaces: input.interfaces.map((endpoint) => ({
          ...structuredClone(endpoint),
          protocol_binding: endpoint.protocol_binding ?? (endpoint.kind === 'a2a' ? 'JSONRPC' : undefined),
          protocol_version: endpoint.protocol_version ?? (endpoint.kind === 'a2a' ? '1.0' : undefined),
        })),
        registered_at: previous?.registered_at ?? now,
        heartbeat_at: now,
      };
      await atomicJson(path, registration);
      return registration;
    });
  }

  async list(): Promise<AgentRegistration[]> {
    if (!existsSync(this.root)) return [];
    const output: AgentRegistration[] = [];
    for (const entry of (await readdir(this.root)).sort()) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      output.push(parseRegistration(await readFile(join(this.root, entry), 'utf8'), id));
    }
    return output;
  }

  async heartbeat(id: string): Promise<AgentRegistration> {
    const path = this.path(id);
    return withDirectoryLock(`${path}.lock`, async () => {
      const agent = await this.load(id);
      agent.heartbeat_at = new Date().toISOString();
      await atomicJson(path, agent);
      return agent;
    });
  }
}
