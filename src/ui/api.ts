import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { validateConfig } from '../config/config.js';
import type { CrewConfig, Run } from '../domain/types.js';
import { ModelCatalog } from '../models/catalog.js';
import { runResponse, store } from '../orchestration/engine.js';
import { changeRunStatus, resumeRun } from '../orchestration/run-control.js';
import { TemplateRegistry, type TemplateScope } from '../templates/registry.js';

const roles = ['planner', 'researcher', 'implementer', 'tester', 'reviewer', 'integrator'];
const capabilities = ['read', 'write', 'shell', 'network', 'commit', 'push', 'deploy', 'destructive'];
const modelPresets = ['configured-by-user', 'configured-by-host'];
const maxBodyBytes = 1024 * 1024;

export class UiHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export class PayloadTooLargeError extends UiHttpError {
  constructor() { super(413, 'request body exceeds 1 MiB'); }
}

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += value.length;
    if (size > maxBodyBytes) throw new PayloadTooLargeError();
    chunks.push(value);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UiHttpError(400, 'request body must be a JSON object');
  return parsed as Record<string, unknown>;
}

export function apiTokenMatches(request: IncomingMessage, token: string): boolean {
  return request.headers['x-agents-crew-token'] === token;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function errorStatus(error: unknown): number {
  if (error instanceof UiHttpError) return error.status;
  if (error instanceof SyntaxError) return 400;
  const message = errorMessage(error);
  if (/not found|unknown action/u.test(message)) return 404;
  if (/invalid|must|cannot|mismatch|required|no roles|needs /u.test(message)) return 400;
  return 500;
}

interface RunSummaryPayload {
  id: string;
  goal: string;
  status: Run['status'];
  manager: string;
  updated_at: string;
  archived: boolean;
  completed_tasks: number;
  total_tasks: number;
}

type RunFilter = 'active' | 'history' | 'all';

async function listRunSummaries(workspace: string, filter: RunFilter = 'all'): Promise<RunSummaryPayload[]> {
  const runStore = store(workspace);
  const summaries: RunSummaryPayload[] = [];
  for (const id of await runStore.listRuns()) {
    try {
      const run = await runStore.load(id);
      const archived = existsSync(runStore.historyRunDir(id));
      if ((filter === 'active' && archived) || (filter === 'history' && !archived)) continue;
      summaries.push({
        id,
        goal: run.original_goal,
        status: run.status,
        manager: run.manager.host,
        updated_at: run.updated_at,
        archived,
        completed_tasks: Object.values(run.tasks).filter((task) => task.status === 'completed').length,
        total_tasks: Object.keys(run.tasks).length,
      });
    } catch { /* skip corrupt or concurrently removed run */ }
  }
  return summaries.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

async function safeFileList(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  async function walk(current: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.locks') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path, relative);
      else files.push(relative);
    }
  }
  await walk(root);
  return files.sort();
}

async function runDetail(workspace: string, run: Run): Promise<unknown> {
  const runStore = store(workspace);
  const response = await runResponse(workspace, run) as Record<string, unknown>;
  return {
    ...response,
    events: await runStore.readEvents(run.id),
    files: await safeFileList(runStore.runDir(run.id)),
    archived: existsSync(runStore.historyRunDir(run.id)),
    expired_actions: await runStore.expiredActions(run.id),
  };
}

function writableScope(value: unknown): Exclude<TemplateScope, 'builtin'> {
  if (value !== 'global' && value !== 'workspace') throw new UiHttpError(400, 'scope must be global or workspace');
  return value;
}

function configPayload(body: Record<string, unknown>, id: string): { scope: Exclude<TemplateScope, 'builtin'>; config: CrewConfig } {
  const scope = writableScope(body.scope);
  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) throw new UiHttpError(400, 'config is required');
  const config = body.config as CrewConfig;
  validateConfig(config);
  if (!config.template) throw new UiHttpError(400, 'template metadata is required');
  if (config.template.id !== id) throw new UiHttpError(400, 'path id must match template metadata id');
  return { scope, config };
}

async function templateRoute(workspace: string, request: IncomingMessage, id: string, url: URL, response: ServerResponse): Promise<void> {
  const registry = new TemplateRegistry(workspace);
  if (request.method === 'GET') { json(response, 200, await registry.resolve(id)); return; }
  if (request.method === 'PUT') {
    const payload = configPayload(await readBody(request), id);
    json(response, 200, await registry.save(payload.scope, payload.config));
    return;
  }
  if (request.method === 'DELETE') {
    const scope = writableScope(url.searchParams.get('scope'));
    await registry.delete(scope, id);
    json(response, 200, { deleted: id, scope });
    return;
  }
  throw new UiHttpError(405, 'method not allowed');
}

async function runRoute(workspace: string, request: IncomingMessage, id: string, action: string | undefined, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && !action) {
    json(response, 200, await runDetail(workspace, await store(workspace).load(id)));
    return;
  }
  if (request.method === 'POST' && action) {
    await readBody(request);
    const run = action === 'resume'
      ? await resumeRun(workspace, id)
      : await changeRunStatus(workspace, id, action === 'pause' ? 'paused' : 'cancelled', 'ui');
    json(response, 200, await runDetail(workspace, run));
    return;
  }
  throw new UiHttpError(405, 'method not allowed');
}

export async function handleApiRequest(
  workspace: string,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  token: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  if (!apiTokenMatches(request, token)) { json(response, 401, { error: 'unauthorized' }); return true; }
  if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
    json(response, 200, {
      templates: await new TemplateRegistry(workspace).list(),
      runs: await listRunSummaries(workspace, 'active'),
      history_runs: await listRunSummaries(workspace, 'history'),
      roles,
      capabilities,
      model_presets: modelPresets,
    });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/templates') {
    json(response, 200, await new TemplateRegistry(workspace).list());
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/models') {
    const host = url.searchParams.get('host') ?? '';
    const refresh = url.searchParams.get('refresh') === '1';
    json(response, 200, await new ModelCatalog(workspace).list(host, refresh));
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/runs') {
    const rawFilter = url.searchParams.get('archived') ?? 'active';
    if (!['active', 'history', 'all'].includes(rawFilter)) throw new UiHttpError(400, 'archived must be active, history, or all');
    json(response, 200, { runs: await listRunSummaries(workspace, rawFilter as RunFilter) });
    return true;
  }
  const template = url.pathname.match(/^\/api\/templates\/([^/]+)$/u);
  if (template) {
    await templateRoute(workspace, request, decodeURIComponent(template[1] as string), url, response);
    return true;
  }
  const run = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(pause|resume|cancel))?$/u);
  if (run) {
    await runRoute(workspace, request, decodeURIComponent(run[1] as string), run[2], response);
    return true;
  }
  json(response, 404, { error: 'not found' });
  return true;
}
