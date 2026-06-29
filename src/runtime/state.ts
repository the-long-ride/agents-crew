import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Capability, OutstandingAction, Run, RunEvent } from '../domain/types.js';

const runStatuses = new Set(['planning', 'working', 'paused', 'awaiting_approval', 'manager_required', 'completed', 'blocked', 'failed', 'cancelled']);
const capabilities = new Set(['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive']);

function parseRunDocument(raw: string, expectedId: string): Run {
  const value = JSON.parse(raw) as Partial<Run> | null;
  if (!value || typeof value !== 'object' || value.id !== expectedId || !runStatuses.has(String(value.status))
    || !value.tasks || typeof value.tasks !== 'object' || Array.isArray(value.tasks)
    || !Array.isArray(value.approvals) || !Array.isArray(value.evidence) || !Array.isArray(value.verification)) {
    throw new Error(`invalid run document: ${expectedId}`);
  }
  return value as Run;
}

function parseActionDocument(raw: string, expectedRunId: string, expectedId?: string): OutstandingAction {
  const value = JSON.parse(raw) as Partial<OutstandingAction> | null;
  if (!value || typeof value !== 'object' || value.run_id !== expectedRunId
    || (expectedId !== undefined && value.id !== expectedId) || typeof value.id !== 'string'
    || typeof value.consumed !== 'boolean' || !Array.isArray(value.capability_envelope)
    || value.capability_envelope.some((item) => !capabilities.has(String(item)))
    || !value.action || typeof value.action !== 'object' || typeof value.action.type !== 'string') {
    throw new Error(`invalid action document: ${expectedId ?? 'unknown'}`);
  }
  return value as OutstandingAction;
}

function assertStorageId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`invalid ${label} identifier: ${value}`);
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await mkdir(path);
      await writeFile(join(path, 'owner.json'), `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
      try {
        return await operation();
      } finally {
        await rm(path, { recursive: true, force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as { pid?: number };
        if (!processAlive(Number(owner.pid))) {
          await rm(path, { recursive: true, force: true });
          continue;
        }
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code === 'ENOENT') {
          await delay(10);
          continue;
        }
        await rm(path, { recursive: true, force: true });
        continue;
      }
      await delay(10);
    }
  }
  throw new Error(`timed out acquiring state lock: ${path}`);
}

export class RunStore {
  readonly activeRoot: string;
  readonly historyRoot: string;
  readonly legacyRoot: string;

  constructor(readonly workspace: string) {
    const base = join(workspace, '.agents-crew');
    this.activeRoot = join(base, 'active');
    this.historyRoot = join(base, 'history');
    this.legacyRoot = join(base, 'runs');
  }

  activeRunDir(id: string): string { assertStorageId(id, 'run'); return join(this.activeRoot, id); }
  historyRunDir(id: string): string { assertStorageId(id, 'run'); return join(this.historyRoot, id); }
  runDir(id: string): string {
    assertStorageId(id, 'run');
    if (existsSync(this.activeRunDir(id))) return this.activeRunDir(id);
    if (existsSync(this.historyRunDir(id))) return this.historyRunDir(id);
    if (existsSync(join(this.legacyRoot, id))) return join(this.legacyRoot, id);
    return this.activeRunDir(id);
  }

  private lockPath(runId: string, name: string): string {
    assertStorageId(runId, 'run');
    assertStorageId(name, 'lock');
    return join(this.runDir(runId), '.locks', name);
  }

  async create(run: Run): Promise<void> {
    const directory = this.activeRunDir(run.id);
    await Promise.all(['actions', 'artifacts', 'context'].map((name) => mkdir(join(directory, name), { recursive: true })));
    await this.save(run);
  }

  async save(run: Run): Promise<void> {
    assertStorageId(run.id, 'run');
    run.updated_at = new Date().toISOString();
    const directory = existsSync(this.historyRunDir(run.id)) ? this.historyRunDir(run.id) : this.activeRunDir(run.id);
    await atomicJson(join(directory, 'run.json'), run);
  }

  async load(id: string): Promise<Run> {
    const path = join(this.runDir(id), 'run.json');
    if (!existsSync(path)) throw new Error(`run not found: ${id}`);
    return parseRunDocument(await readFile(path, 'utf8'), id);
  }

  async archive(id: string): Promise<string> {
    const active = this.activeRunDir(id);
    const history = this.historyRunDir(id);
    if (existsSync(history)) throw new Error(`run already archived: ${id}`);
    if (!existsSync(active)) throw new Error(`run not found: ${id}`);
    await mkdir(this.historyRoot, { recursive: true });
    await rename(active, history);
    return history;
  }

  async listRuns(): Promise<string[]> {
    const seen = new Set<string>();
    for (const root of [this.activeRoot, this.historyRoot, this.legacyRoot]) {
      if (!existsSync(root)) continue;
      for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory()) seen.add(entry.name);
    }
    return [...seen].sort();
  }

  async latestRunId(): Promise<string | undefined> {
    let latest: { id: string; modified: number } | undefined;
    for (const id of await this.listRuns()) {
      const path = join(this.runDir(id), 'run.json');
      if (!existsSync(path)) continue;
      const modified = (await stat(path)).mtimeMs;
      if (!latest || modified > latest.modified) latest = { id, modified };
    }
    return latest?.id;
  }

  async appendEvent(runId: string, kind: string, data: unknown): Promise<RunEvent> {
    return withFileLock(this.lockPath(runId, 'events'), async () => {
      const events = await this.readEvents(runId);
      const event: RunEvent = { sequence: (events.at(-1)?.sequence ?? 0) + 1, timestamp: new Date().toISOString(), kind, data };
      const path = join(this.runDir(runId), 'events.jsonl');
      await mkdir(dirname(path), { recursive: true });
      const file = await open(path, 'a');
      try { await file.write(`${JSON.stringify(event)}\n`); } finally { await file.close(); }
      return event;
    });
  }

  async readEvents(runId: string): Promise<RunEvent[]> {
    const path = join(this.runDir(runId), 'events.jsonl');
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as RunEvent);
  }

  async saveAction(action: OutstandingAction): Promise<void> {
    assertStorageId(action.id, 'action');
    await atomicJson(join(this.runDir(action.run_id), 'actions', `${action.id}.json`), action);
  }

  async loadAction(runId: string, id: string): Promise<OutstandingAction> {
    assertStorageId(id, 'action');
    const path = join(this.runDir(runId), 'actions', `${id}.json`);
    if (!existsSync(path)) throw new Error(`unknown action: ${id}`);
    return parseActionDocument(await readFile(path, 'utf8'), runId, id);
  }

  async consumeAction(runId: string, id: string, claimed: Capability[]): Promise<OutstandingAction> {
    assertStorageId(id, 'action');
    return withFileLock(this.lockPath(runId, `action-${id}`), async () => {
      const action = await this.loadAction(runId, id);
      if (action.consumed) throw new Error(`action already consumed: ${id}`);
      if (action.expires_at && Date.parse(action.expires_at) <= Date.now()) throw new Error(`action expired: ${id}`);
      if (claimed.some((capability) => !action.capability_envelope.includes(capability))) throw new Error('action capability mismatch');
      action.consumed = true;
      await this.saveAction(action);
      return action;
    });
  }

  async expiredActions(runId: string): Promise<OutstandingAction[]> {
    const directory = join(this.runDir(runId), 'actions');
    if (!existsSync(directory)) return [];
    const output: OutstandingAction[] = [];
    for (const entry of await readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const action = parseActionDocument(await readFile(join(directory, entry), 'utf8'), runId, entry.slice(0, -5));
      if (!action.consumed && action.expires_at && Date.parse(action.expires_at) <= Date.now()) output.push(action);
    }
    return output.sort((left, right) => left.issued_at.localeCompare(right.issued_at));
  }

  async pendingActions(runId: string): Promise<OutstandingAction[]> {
    const directory = join(this.runDir(runId), 'actions');
    if (!existsSync(directory)) return [];
    const output: OutstandingAction[] = [];
    for (const entry of await readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const action = parseActionDocument(await readFile(join(directory, entry), 'utf8'), runId, entry.slice(0, -5));
      if (!action.consumed && (!action.expires_at || Date.parse(action.expires_at) > Date.now())) output.push(action);
    }
    return output.sort((left, right) => left.issued_at.localeCompare(right.issued_at));
  }
}
