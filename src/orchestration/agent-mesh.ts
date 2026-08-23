import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readyTasks, taskGraph, taskWrites, validateTaskId, verifyTaskResult } from '../domain/core.js';
import { decidePolicy } from '../domain/policy.js';
import { enforceTaskPolicy } from '../domain/task-policy.js';
import type {
  AgentMessage, AgentMessageDraft, AgentMessageKind, AgentRegistration, AgentRegistrationInput,
  CrewConfig, Run, Task, TaskLease, WorkerResult,
} from '../domain/types.js';
import { GitRepository } from '../runtime/git.js';
import { RunStore } from '../runtime/state.js';
import { atomicJson, withDirectoryLock } from '../shared/durable-fs.js';
import { sendA2AMessage } from './a2a.js';
import { AgentMailbox } from './agent-mailbox.js';
import { AgentRegistry, assertAgentId } from './agent-registry.js';
import { RunProtocol } from './protocol.js';

const messageKinds = new Set<AgentMessageKind>(['message', 'request', 'response', 'review', 'blocker']);
const terminalTaskStatuses = new Set(['completed', 'failed', 'cancelled']);

function visibleChanges(paths: string[]): string[] {
  return paths.filter((path) => path !== '.agents-crew' && !path.startsWith('.agents-crew/'));
}

function parseLease(raw: string, runId: string, taskId: string): TaskLease {
  const value = JSON.parse(raw) as TaskLease;
  const snapshot = value?.workspace_snapshot;
  if (!value || value.run_id !== runId || value.task_id !== taskId || typeof value.agent_id !== 'string'
    || !Number.isInteger(value.revision) || value.revision < 1 || typeof value.claimed_at !== 'string' || typeof value.expires_at !== 'string'
    || (value.workspace_binding !== undefined && typeof value.workspace_binding !== 'string')
    || (snapshot !== undefined && (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || Object.values(snapshot).some((entry) => typeof entry !== 'string')))) {
    throw new Error(`invalid task lease: ${taskId}`);
  }
  return value;
}

function taskReady(run: Run, taskId: string): boolean {
  return readyTasks(taskGraph(Object.values(run.tasks))).some((task) => task.id === taskId);
}

export class AgentMesh {
  readonly store: RunStore;
  readonly registry: AgentRegistry;
  readonly mailbox: AgentMailbox;

  constructor(readonly workspace: string) {
    this.store = new RunStore(workspace);
    this.registry = new AgentRegistry(workspace);
    this.mailbox = new AgentMailbox(this.store);
  }

  private claimsRoot(runId: string): string { return join(this.store.runDir(runId), 'agents', 'claims'); }
  private claimLock(runId: string): string { return join(this.claimsRoot(runId), '.lock'); }
  private leasePath(runId: string, taskId: string): string {
    validateTaskId(taskId);
    return join(this.claimsRoot(runId), `${taskId}.json`);
  }

  private async loadLeases(runId: string): Promise<TaskLease[]> {
    const root = this.claimsRoot(runId);
    if (!existsSync(root)) return [];
    const leases: TaskLease[] = [];
    for (const entry of await readdir(root)) {
      if (!entry.endsWith('.json')) continue;
      const taskId = entry.slice(0, -5);
      leases.push(parseLease(await readFile(join(root, entry), 'utf8'), runId, taskId));
    }
    return leases;
  }

  private async recoverExpiredLeases(run: Run): Promise<{ live: TaskLease[]; expired: TaskLease[] }> {
    const live: TaskLease[] = [];
    const expired: TaskLease[] = [];
    let changed = false;
    for (const lease of await this.loadLeases(run.id)) {
      if (Date.parse(lease.expires_at) > Date.now()) { live.push(lease); continue; }
      expired.push(lease);
      await rm(this.leasePath(run.id, lease.task_id), { force: true });
      const task = run.tasks[lease.task_id];
      if (task?.status === 'running' && task.assigned_worker === lease.agent_id) {
        task.status = 'retryable';
        task.assigned_worker = undefined;
        changed = true;
      }
      await this.store.appendEvent(run.id, 'task_lease_expired', {
        task_id: lease.task_id, agent_id: lease.agent_id, revision: lease.revision,
      });
    }
    if (changed) {
      await this.store.save(run);
      await new RunProtocol(this.workspace).sync(run);
    }
    return { live, expired };
  }

  private enforceConcurrency(config: CrewConfig, run: Run, live: TaskLease[], task: Task): void {
    const active = live.filter((lease) => lease.task_id !== task.id && run.tasks[lease.task_id]?.status === 'running');
    if (active.length >= Math.max(1, config.run.max_tasks_per_iteration)) throw new Error('parallel task limit reached');
    const activeTasks = active.map((lease) => run.tasks[lease.task_id]).filter((value): value is Task => Boolean(value));
    if (taskWrites(task)) {
      const limit = run.workspace_mode === 'current' ? 1 : Math.max(1, config.run.max_parallel_writers);
      if (activeTasks.filter(taskWrites).length >= limit) throw new Error('parallel writer limit reached');
    } else if (activeTasks.filter((item) => !taskWrites(item)).length >= Math.max(1, config.run.max_parallel_readers)) {
      throw new Error('parallel reader limit reached');
    }
  }

  private async prepareLeaseWorkspace(run: Run, task: Task, inherited?: TaskLease): Promise<{ binding?: string; snapshot?: Record<string, string> }> {
    let binding = inherited?.workspace_binding ?? task.workspace_binding ?? this.workspace;
    if (run.workspace_mode === 'isolated' && taskWrites(task) && !inherited?.workspace_binding && !task.workspace_binding) {
      const repository = await GitRepository.discover(this.workspace);
      binding = await repository.createTaskWorktree(run.id, task.id);
      task.workspace_binding = binding;
    }
    if (inherited?.workspace_snapshot) return { binding, snapshot: inherited.workspace_snapshot };
    try {
      const repository = await GitRepository.discover(binding);
      return { binding, snapshot: await repository.snapshotChanges(binding) };
    } catch (error) {
      if (run.workspace_mode === 'isolated' && taskWrites(task)) throw error;
      return { binding };
    }
  }

  private async directTransportAllowed(runId: string, credentialed: boolean): Promise<boolean> {
    try {
      const config = await new RunProtocol(this.workspace).loadSnapshot(runId);
      const context = {
        manager_coding: config.manager.coding,
        small_fix_max_files: config.manager.small_fix_max_files,
        small_fix_max_changed_lines: config.manager.small_fix_max_changed_lines,
      } as const;
      if (decidePolicy(config.permissions, { type: 'network' }, context) !== 'allow') return false;
      return !credentialed || decidePolicy(config.permissions, { type: 'credentialed_action' }, context) === 'allow';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  register(input: AgentRegistrationInput): Promise<AgentRegistration> { return this.registry.register(input); }
  listAgents(): Promise<AgentRegistration[]> { return this.registry.list(); }
  heartbeat(agentId: string): Promise<AgentRegistration> { return this.registry.heartbeat(agentId); }

  async claimTask(runId: string, taskId: string, agentId: string, leaseSeconds = 300): Promise<TaskLease> {
    const agent = await this.registry.load(agentId);
    if (!Number.isFinite(leaseSeconds) || leaseSeconds < 0) throw new Error('lease seconds must be a non-negative number');
    validateTaskId(taskId);
    return withDirectoryLock(this.claimLock(runId), async () => {
      const run = await this.store.load(runId);
      if (run.status !== 'working') throw new Error(`run ${runId} cannot accept task claims while ${run.status}`);
      const task = run.tasks[taskId];
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (terminalTaskStatuses.has(task.status)) throw new Error(`task ${taskId} is terminal: ${task.status}`);
      const { live, expired } = await this.recoverExpiredLeases(run);
      const previous = live.find((lease) => lease.task_id === taskId);
      if (previous && previous.agent_id !== agentId) throw new Error(`task ${taskId} is leased by ${previous.agent_id}`);
      const renewing = Boolean(previous && previous.agent_id === agentId && task.status === 'running');
      if (!renewing && !taskReady(run, taskId)) throw new Error(`task ${taskId} is not dependency-ready: ${task.status}`);
      if (!agent.roles.includes(task.role)) throw new Error(`agent ${agentId} lacks required role ${task.role}`);
      if (task.preferred_workers.length && !task.preferred_workers.includes(agentId)) {
        throw new Error(`agent ${agentId} is not a preferred worker for task ${taskId}`);
      }
      const missing = task.capabilities.filter((capability) => !agent.capabilities.includes(capability));
      if (missing.length) throw new Error(`agent ${agentId} lacks task capabilities: ${missing.join(', ')}`);
      const protocol = new RunProtocol(this.workspace);
      const config = await protocol.loadSnapshot(runId);
      const approval = enforceTaskPolicy(config, run, task);
      if (approval) {
        const existing = run.approvals.find((item) => item.operation === approval.operation && item.status === 'pending');
        const pending = existing ?? approval;
        if (!existing) run.approvals.push(approval);
        task.status = 'blocked';
        task.assigned_worker = undefined;
        run.status = 'awaiting_approval';
        await this.store.save(run);
        await protocol.sync(run);
        await this.store.appendEvent(runId, 'approval_requested', pending);
        throw new Error(`approval required: ${pending.id} for ${pending.operation}`);
      }
      if (!renewing) this.enforceConcurrency(config, run, live, task);
      const inherited = previous ?? expired.find((lease) => lease.task_id === taskId);
      const leaseWorkspace = await this.prepareLeaseWorkspace(run, task, inherited);
      const now = new Date();
      const lease: TaskLease = {
        run_id: runId,
        task_id: taskId,
        agent_id: agentId,
        claimed_at: previous?.claimed_at ?? now.toISOString(),
        expires_at: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        revision: (inherited?.revision ?? 0) + 1,
        workspace_binding: leaseWorkspace.binding,
        workspace_snapshot: leaseWorkspace.snapshot,
      };
      await atomicJson(this.leasePath(runId, taskId), lease);
      task.status = 'running';
      task.assigned_worker = agentId;
      await this.store.save(run);
      await protocol.sync(run);
      await this.store.appendEvent(runId, renewing ? 'task_lease_renewed' : 'task_claimed', {
        task_id: taskId, agent_id: agentId, revision: lease.revision,
        expires_at: lease.expires_at, workspace: lease.workspace_binding,
      });
      return lease;
    });
  }

  async releaseTask(runId: string, taskId: string, agentId: string, force = false): Promise<void> {
    assertAgentId(agentId);
    validateTaskId(taskId);
    await withDirectoryLock(this.claimLock(runId), async () => {
      const path = this.leasePath(runId, taskId);
      if (!existsSync(path)) throw new Error(`task lease not found: ${taskId}`);
      const lease = parseLease(await readFile(path, 'utf8'), runId, taskId);
      if (!force && lease.agent_id !== agentId) throw new Error(`task ${taskId} is leased by ${lease.agent_id}`);
      const run = await this.store.load(runId);
      const task = run.tasks[taskId];
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (run.workspace_mode === 'isolated' && taskWrites(task) && lease.workspace_binding && lease.workspace_binding !== this.workspace) {
        await (await GitRepository.discover(this.workspace)).cleanupTaskWorktree(lease.workspace_binding);
        task.workspace_binding = undefined;
      }
      await rm(path, { force: true });
      if (!terminalTaskStatuses.has(task.status)) {
        task.status = 'ready';
        task.assigned_worker = undefined;
      }
      await this.store.save(run);
      await new RunProtocol(this.workspace).sync(run);
      await this.store.appendEvent(runId, 'task_released', { task_id: taskId, agent_id: agentId, force });
    });
  }

  async completeTask(runId: string, taskId: string, agentId: string, result: WorkerResult, resultPath?: string): Promise<Task> {
    assertAgentId(agentId);
    validateTaskId(taskId);
    return withDirectoryLock(this.claimLock(runId), async () => {
      const path = this.leasePath(runId, taskId);
      if (!existsSync(path)) throw new Error(`task lease not found: ${taskId}`);
      const lease = parseLease(await readFile(path, 'utf8'), runId, taskId);
      if (lease.agent_id !== agentId) throw new Error(`task ${taskId} is leased by ${lease.agent_id}`);
      if (Date.parse(lease.expires_at) <= Date.now()) throw new Error(`task lease expired: ${taskId}`);
      const run = await this.store.load(runId);
      if (['completed', 'cancelled', 'failed'].includes(run.status)) throw new Error(`run ${runId} is terminal: ${run.status}`);
      const task = run.tasks[taskId];
      if (!task) throw new Error(`task not found: ${taskId}`);
      if (task.status !== 'running' || task.assigned_worker !== agentId) throw new Error(`task ${taskId} is not running for ${agentId}`);
      verifyTaskResult(task, result);
      const binding = lease.workspace_binding ?? task.workspace_binding ?? this.workspace;
      let repository: GitRepository | undefined;
      try { repository = await GitRepository.discover(binding); }
      catch { if (taskWrites(task)) throw new Error(`write task ${task.id} requires a Git repository`); }
      let changes = repository ? visibleChanges(await repository.changedSince(lease.workspace_snapshot ?? {}, binding)) : [...result.files_changed];
      if (resultPath) {
        const ignored = relative(resolve(binding), resolve(resultPath));
        if (ignored && !ignored.startsWith('..') && !isAbsolute(ignored)) {
          const normalized = ignored.replaceAll('\\', '/');
          changes = changes.filter((pathName) => pathName !== normalized);
        }
      }
      if (!taskWrites(task) && changes.length) throw new Error(`read-only task changed files: ${changes.join(', ')}`);
      if (repository) repository.validateWriteScope(task.write_scope, changes);
      const normalized: WorkerResult = { ...structuredClone(result), files_changed: changes };
      if (taskWrites(task) && run.workspace_mode === 'isolated' && binding !== this.workspace) {
        const main = await GitRepository.discover(this.workspace);
        await main.integrateTaskWorktree(binding);
        await main.cleanupTaskWorktree(binding);
      }
      task.status = 'completed';
      task.result = normalized;
      run.evidence.push(...normalized.evidence);
      run.verification.push(...normalized.tests);
      await rm(path, { force: true });
      await this.store.save(run);
      await new RunProtocol(this.workspace).sync(run);
      await this.store.appendEvent(runId, 'task_completed', {
        task_id: taskId, worker: agentId, source: 'agent_mesh', files_changed: changes,
      });
      return structuredClone(task);
    });
  }

  async sendMessage(runId: string, draft: AgentMessageDraft): Promise<AgentMessage> {
    const [sender, recipient] = await Promise.all([this.registry.load(draft.from), this.registry.load(draft.to)]);
    if (!messageKinds.has(draft.kind)) throw new Error(`invalid message kind: ${draft.kind}`);
    if (!draft.body.trim()) throw new Error('message body is required');
    if (draft.task_id) validateTaskId(draft.task_id);
    await this.store.load(runId);
    const message: AgentMessage = {
      ...structuredClone(draft), id: randomUUID(), run_id: runId,
      created_at: new Date().toISOString(), delivery: 'mailbox',
    };
    await this.mailbox.append(runId, message);
    const direct = recipient.interfaces.find((endpoint) => endpoint.kind === 'a2a' && (endpoint.protocol_binding ?? 'JSONRPC') === 'JSONRPC');
    const credentialed = Boolean(direct && Object.keys(direct.headers_env ?? {}).length);
    if (direct && sender.capabilities.includes('network') && await this.directTransportAllowed(runId, credentialed)) {
      try {
        await sendA2AMessage(direct, message);
        message.delivery = 'a2a';
      } catch (error) {
        message.direct_error = error instanceof Error ? error.message : String(error);
      }
      await this.mailbox.recordDelivery(runId, message);
    }
    await this.store.appendEvent(runId, 'agent_message_sent', {
      message_id: message.id, from: message.from, to: message.to,
      task_id: message.task_id, delivery: message.delivery, direct_error: message.direct_error,
    });
    return message;
  }

  inbox(runId: string, agentId: string): Promise<AgentMessage[]> { return this.mailbox.inbox(runId, agentId); }
}
