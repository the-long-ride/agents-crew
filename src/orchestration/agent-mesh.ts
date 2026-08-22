import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateTaskId } from '../domain/core.js';
import type { AgentMessage, AgentMessageDraft, AgentRegistration, AgentRegistrationInput, Capability, Role, TaskLease } from '../domain/types.js';
import { RunStore } from '../runtime/state.js';
import { RunProtocol } from './protocol.js';

const roles = new Set<Role>(['manager', 'planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator']);
const capabilities = new Set<Capability>(['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive']);
const terminalTaskStatuses = new Set(['completed', 'failed', 'cancelled']);

function assertId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) || value === '.' || value === '..') throw new Error(`invalid ${label} identifier: ${value}`);
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      await mkdir(path);
      try { return await operation(); }
      finally { await rm(path, { recursive: true, force: true }); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(path)).mtimeMs > 30_000) {
          await rm(path, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      await delay(5);
    }
  }
  throw new Error(`timed out acquiring agent mesh lock: ${path}`);
}

function validateRegistration(input: AgentRegistrationInput): void {
  assertId(input.id, 'agent');
  if (!Array.isArray(input.roles) || input.roles.some((role) => !roles.has(role))) throw new Error('invalid agent roles');
  if (!Array.isArray(input.capabilities) || input.capabilities.some((capability) => !capabilities.has(capability))) throw new Error('invalid agent capabilities');
  if (!Array.isArray(input.interfaces)) throw new Error('invalid agent interfaces');
  for (const endpoint of input.interfaces) {
    if (!endpoint || !['a2a', 'mailbox'].includes(endpoint.kind)) throw new Error('invalid agent interface');
    if (endpoint.kind === 'a2a') {
      if (!endpoint.url) throw new Error('a2a interface url is required');
      const protocol = new URL(endpoint.url).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') throw new Error('a2a interface must use http or https');
      if (endpoint.headers_env && Object.values(endpoint.headers_env).some((name) => !name.trim())) throw new Error('a2a header env names must be non-empty');
    }
  }
}

function parseRegistration(raw: string, expectedId: string): AgentRegistration {
  const value = JSON.parse(raw) as AgentRegistration;
  if (!value || typeof value !== 'object' || value.id !== expectedId || typeof value.registered_at !== 'string' || typeof value.heartbeat_at !== 'string') {
    throw new Error(`invalid agent registration: ${expectedId}`);
  }
  validateRegistration(value);
  return value;
}

function parseLease(raw: string, runId: string, taskId: string): TaskLease {
  const value = JSON.parse(raw) as TaskLease;
  if (!value || value.run_id !== runId || value.task_id !== taskId || typeof value.agent_id !== 'string'
    || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.claimed_at !== 'string' || typeof value.expires_at !== 'string') {
    throw new Error(`invalid task lease: ${taskId}`);
  }
  return value;
}

export class AgentMesh {
  readonly store: RunStore;
  readonly agentsRoot: string;

  constructor(readonly workspace: string) {
    this.store = new RunStore(workspace);
    this.agentsRoot = join(workspace, '.agents-crew', 'agents');
  }

  private agentPath(id: string): string { assertId(id, 'agent'); return join(this.agentsRoot, `${id}.json`); }
  private leasePath(runId: string, taskId: string): string {
    validateTaskId(taskId);
    return join(this.store.runDir(runId), 'agents', 'claims', `${taskId}.json`);
  }

  private async loadAgent(id: string): Promise<AgentRegistration> {
    const path = this.agentPath(id);
    if (!existsSync(path)) throw new Error(`agent not found: ${id}`);
    return parseRegistration(await readFile(path, 'utf8'), id);
  }

  async register(input: AgentRegistrationInput): Promise<AgentRegistration> {
    validateRegistration(input);
    const path = this.agentPath(input.id);
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
  }

  async listAgents(): Promise<AgentRegistration[]> {
    if (!existsSync(this.agentsRoot)) return [];
    const output: AgentRegistration[] = [];
    for (const entry of (await readdir(this.agentsRoot)).sort()) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      output.push(parseRegistration(await readFile(join(this.agentsRoot, entry), 'utf8'), id));
    }
    return output;
  }

  async heartbeat(agentId: string): Promise<AgentRegistration> {
    const agent = await this.loadAgent(agentId);
    agent.heartbeat_at = new Date().toISOString();
    await atomicJson(this.agentPath(agentId), agent);
    return agent;
  }

  async claimTask(runId: string, taskId: string, agentId: string, leaseSeconds = 300): Promise<TaskLease> {
    await this.loadAgent(agentId);
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 0) throw new Error('lease seconds must be a non-negative number');
    const path = this.leasePath(runId, taskId);
    return withLock(`${path}.lock`, async () => {
      let previous: TaskLease | undefined;
      if (existsSync(path)) previous = parseLease(await readFile(path, 'utf8'), runId, taskId);
      if (previous && Date.parse(previous.expires_at) > Date.now() && previous.agent_id !== agentId) throw new Error(`task ${taskId} is leased by ${previous.agent_id}`);
      const run = await this.store.load(runId);
      const task = run.tasks[taskId];
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (terminalTaskStatuses.has(task.status)) throw new Error(`task ${taskId} is terminal: ${task.status}`);
      if (!['ready', 'retryable', 'running'].includes(task.status)) throw new Error(`task ${taskId} is not claimable: ${task.status}`);
      const claimedAt = new Date();
      const lease: TaskLease = {
        run_id: runId,
        task_id: taskId,
        agent_id: agentId,
        claimed_at: claimedAt.toISOString(),
        expires_at: new Date(claimedAt.getTime() + leaseSeconds * 1000).toISOString(),
        revision: (previous?.revision ?? 0) + 1,
      };
      await atomicJson(path, lease);
      task.status = 'running';
      task.assigned_worker = agentId;
      await this.store.save(run);
      await new RunProtocol(this.workspace).sync(run);
      await this.store.appendEvent(runId, 'task_claimed', { task_id: taskId, agent_id: agentId, revision: lease.revision, expires_at: lease.expires_at });
      return lease;
    });
  }

  async releaseTask(runId: string, taskId: string, agentId: string, force = false): Promise<void> {
    assertId(agentId, 'agent');
    const path = this.leasePath(runId, taskId);
    await withLock(`${path}.lock`, async () => {
      if (!existsSync(path)) throw new Error(`task lease not found: ${taskId}`);
      const lease = parseLease(await readFile(path, 'utf8'), runId, taskId);
      if (!force && lease.agent_id !== agentId) throw new Error(`task ${taskId} is leased by ${lease.agent_id}`);
      await rm(path, { force: true });
      const run = await this.store.load(runId);
      const task = run.tasks[taskId];
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (!terminalTaskStatuses.has(task.status)) {
        task.status = 'ready';
        task.assigned_worker = undefined;
      }
      await this.store.save(run);
      await new RunProtocol(this.workspace).sync(run);
      await this.store.appendEvent(runId, 'task_released', { task_id: taskId, agent_id: agentId, force });
    });
  }

  async sendMessage(runId: string, draft: AgentMessageDraft): Promise<AgentMessage> {
    await Promise.all([this.loadAgent(draft.from), this.loadAgent(draft.to)]);
    if (!draft.body.trim()) throw new Error('message body is required');
    if (draft.task_id) validateTaskId(draft.task_id);
    await this.store.load(runId);
    const message: AgentMessage = {
      ...structuredClone(draft), id: randomUUID(), run_id: runId, created_at: new Date().toISOString(), delivery: 'mailbox',
    };
    const path = join(this.store.runDir(runId), 'communication', `${draft.to}.jsonl`);
    await withLock(`${path}.lock`, async () => {
      await mkdir(dirname(path), { recursive: true });
      const file = await open(path, 'a');
      try { await file.write(`${JSON.stringify(message)}\n`); }
      finally { await file.close(); }
    });
    await this.store.appendEvent(runId, 'agent_message_sent', { message_id: message.id, from: message.from, to: message.to, task_id: message.task_id, delivery: message.delivery });
    return message;
  }

  async inbox(runId: string, agentId: string): Promise<AgentMessage[]> {
    assertId(agentId, 'agent');
    await this.store.load(runId);
    const path = join(this.store.runDir(runId), 'communication', `${agentId}.jsonl`);
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as AgentMessage);
  }
}
