import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { assetPath } from './assets.js';
import { runResponse, store } from './engine.js';
import { changeRunStatus, resumeRun } from './run-control.js';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const maxBodyBytes = 1024 * 1024;

class PayloadTooLargeError extends Error {}

export function safeStaticPath(root: string, requested: string): string {
  const decoded = decodeURIComponent(requested.split('?')[0] ?? '/').replaceAll('\\', '/');
  if (decoded.split('/').includes('..')) throw new Error('invalid static path');
  const clean = normalize(decoded).replace(/^[/\\]+/u, '');
  const path = resolve(root, clean || 'index.html');
  const base = resolve(root);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error('invalid static path');
  return path;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += value.length;
    if (size > maxBodyBytes) throw new PayloadTooLargeError('request body exceeds 1 MiB');
    chunks.push(value);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export function apiTokenMatches(request: IncomingMessage, token: string): boolean {
  return request.headers['x-agents-crew-token'] === token;
}

async function api(workspace: string, request: IncomingMessage, response: ServerResponse, pathname: string, token: string): Promise<boolean> {
  if (!apiTokenMatches(request, token)) { json(response, 401, { error: 'unauthorized' }); return true; }
  if (request.method === 'GET' && pathname === '/api/runs') {
    const runStore = store(workspace);
    const runs = [];
    for (const id of await runStore.listRuns()) {
      try { const run = await runStore.load(id); runs.push({ id, goal: run.original_goal, status: run.status, updated_at: run.updated_at }); } catch { /* skip invalid run */ }
    }
    json(response, 200, { runs: runs.sort((left, right) => right.updated_at.localeCompare(left.updated_at)) });
    return true;
  }
  const match = pathname.match(/^\/api\/runs\/([^/]+)(?:\/(pause|resume|cancel))?$/u);
  if (!match) return false;
  const id = decodeURIComponent(match[1] as string);
  const action = match[2];
  if (request.method === 'GET' && !action) {
    const run = await store(workspace).load(id);
    json(response, 200, await runResponse(workspace, run));
    return true;
  }
  if (request.method === 'POST' && action) {
    await readBody(request);
    const run = action === 'resume'
      ? await resumeRun(workspace, id)
      : await changeRunStatus(workspace, id, action === 'pause' ? 'paused' : 'cancelled', 'ui');
    json(response, 200, await runResponse(workspace, run));
    return true;
  }
  return false;
}

function errorStatus(error: unknown): number {
  if (error instanceof PayloadTooLargeError) return 413;
  if (error instanceof SyntaxError || (error instanceof Error && error.message === 'invalid static path')) return 400;
  return 500;
}

export function createUiServer(workspace: string, token: string): Server {
  const staticRoot = assetPath('dist', 'ui');
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/') && await api(workspace, request, response, url.pathname, token)) return;
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const path = safeStaticPath(staticRoot, requested);
      if (!existsSync(path)) { json(response, 404, { error: 'not found' }); return; }
      response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      createReadStream(path).pipe(response);
    } catch (error) {
      json(response, errorStatus(error), { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function openBrowser(url: string, launch = spawn): void {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = launch(command, args, { detached: true, stdio: 'ignore' });
  child.once('error', () => {});
  child.unref();
}

export async function serveUi(workspace: string, port = 0, noOpen = false): Promise<unknown> {
  const token = randomUUID();
  const server = createUiServer(workspace, token);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to resolve UI address');
  const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
  if (!noOpen) openBrowser(url);
  process.stdout.write(`Agents Crew UI: ${url}\n`);
  await new Promise<void>((resolveClose) => {
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      server.close(() => resolveClose());
    };
    const cleanup = (): void => { process.off('SIGINT', close); process.off('SIGTERM', close); };
    server.once('close', cleanup);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
  return { url, closed: true };
}
