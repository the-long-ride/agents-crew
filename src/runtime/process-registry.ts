import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ManagedProcessState = 'running' | 'pausing' | 'paused' | 'stopping' | 'exited' | 'failed';
export type ManagedProcessControl = 'restart' | 'stop';

export interface ManagedProcessRecord {
  id: string;
  worker_id: string;
  host: string;
  pid: number;
  run_id: string;
  task_id: string;
  workspace: string;
  started_at: string;
  updated_at: string;
  state: ManagedProcessState;
  exit_code?: number;
  message?: string;
  control?: { action: ManagedProcessControl; requested_at: string };
}

export interface RegisterProcessInput {
  worker_id: string;
  host: string;
  pid: number;
  run_id: string;
  task_id: string;
  workspace: string;
  started_at?: string;
}

interface RegistryOptions {
  now?: () => number;
  retention_ms?: number;
}

const activeStates = new Set<ManagedProcessState>(['running', 'pausing', 'stopping']);
const terminalStates = new Set<ManagedProcessState>(['exited', 'failed']);

function validId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(id)) throw new Error(`invalid process id: ${id}`);
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class ProcessRegistry {
  private readonly root: string;
  private readonly locks: string;
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(readonly workspace: string, options: RegistryOptions = {}) {
    this.root = join(workspace, '.agents-crew', 'runtime', 'processes');
    this.locks = join(workspace, '.agents-crew', 'runtime', '.locks');
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retention_ms ?? 60_000;
  }

  private file(id: string): string { validId(id); return join(this.root, `${id}.json`); }
  private lock(id: string): string { validId(id); return join(this.locks, id); }

  private async atomicWrite(record: ManagedProcessRecord): Promise<void> {
    const path = this.file(record.id);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temp, path);
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const path = this.lock(id);
    await mkdir(dirname(path), { recursive: true });
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        await mkdir(path);
        try { return await operation(); }
        finally { await rm(path, { recursive: true, force: true }); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await delay(10);
      }
    }
    throw new Error(`timed out acquiring process lock: ${id}`);
  }

  private parse(raw: string, id: string): ManagedProcessRecord {
    const value = JSON.parse(raw) as Partial<ManagedProcessRecord> | null;
    if (!value || value.id !== id || typeof value.worker_id !== 'string' || typeof value.host !== 'string'
      || typeof value.pid !== 'number' || typeof value.run_id !== 'string' || typeof value.task_id !== 'string'
      || typeof value.workspace !== 'string' || typeof value.started_at !== 'string' || typeof value.updated_at !== 'string'
      || !['running', 'pausing', 'paused', 'stopping', 'exited', 'failed'].includes(String(value.state))) {
      throw new Error(`invalid managed process record: ${id}`);
    }
    return value as ManagedProcessRecord;
  }

  async get(id: string): Promise<ManagedProcessRecord | undefined> {
    const path = this.file(id);
    if (!existsSync(path)) return undefined;
    return this.parse(await readFile(path, 'utf8'), id);
  }

  async register(input: RegisterProcessInput): Promise<ManagedProcessRecord> {
    const started = input.started_at ?? new Date(this.now()).toISOString();
    const record: ManagedProcessRecord = {
      id: randomUUID(), worker_id: input.worker_id, host: input.host, pid: input.pid,
      run_id: input.run_id, task_id: input.task_id, workspace: input.workspace,
      started_at: started, updated_at: started, state: 'running',
    };
    await this.atomicWrite(record);
    return record;
  }

  async update(id: string, patch: Partial<Pick<ManagedProcessRecord, 'state' | 'exit_code' | 'message'>>): Promise<ManagedProcessRecord> {
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new Error(`process not found: ${id}`);
      Object.assign(record, patch, { updated_at: new Date(this.now()).toISOString() });
      await this.atomicWrite(record);
      return record;
    });
  }

  async requestControl(id: string, action: string): Promise<ManagedProcessRecord> {
    if (action !== 'restart' && action !== 'stop') throw new Error(`invalid process control action: ${action}`);
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new Error(`process not found: ${id}`);
      if (!activeStates.has(record.state)) throw new Error(`cannot ${action} process in ${record.state} state`);
      record.control = { action, requested_at: new Date(this.now()).toISOString() };
      record.state = 'stopping';
      record.updated_at = new Date(this.now()).toISOString();
      await this.atomicWrite(record);
      return record;
    });
  }

  async consumeControl(id: string): Promise<ManagedProcessRecord['control'] | undefined> {
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) return undefined;
      const control = record.control;
      if (!control) return undefined;
      delete record.control;
      record.updated_at = new Date(this.now()).toISOString();
      await this.atomicWrite(record);
      return control;
    });
  }

  async complete(id: string, state: 'paused' | 'exited' | 'failed', exitCode?: number, message?: string): Promise<ManagedProcessRecord> {
    return this.withLock(id, async () => {
      const record = await this.get(id);
      if (!record) throw new Error(`process not found: ${id}`);
      record.state = state;
      record.exit_code = exitCode;
      record.message = message;
      delete record.control;
      record.updated_at = new Date(this.now()).toISOString();
      await this.atomicWrite(record);
      return record;
    });
  }

  async list(): Promise<ManagedProcessRecord[]> {
    if (!existsSync(this.root)) return [];
    const records: ManagedProcessRecord[] = [];
    for (const entry of await readdir(this.root)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      try {
        let record = await this.get(id);
        if (!record) continue;
        if (activeStates.has(record.state) && !alive(record.pid)) {
          record = await this.complete(id, 'failed', record.exit_code, 'managed process is no longer alive');
        }
        records.push(record);
      } catch { /* isolate corrupt records */ }
    }
    return records.sort((left, right) => right.started_at.localeCompare(left.started_at));
  }

  async prune(): Promise<void> {
    const records = await this.list();
    for (const record of records) {
      if (!terminalStates.has(record.state)) continue;
      if (this.now() - Date.parse(record.updated_at) > this.retentionMs) await rm(this.file(record.id), { force: true });
    }
  }
}
