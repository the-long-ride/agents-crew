import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { assetPath } from '../shared/assets.js';
import { errorStatus, handleApiRequest, json } from './api.js';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export { apiTokenMatches } from './api.js';

export function safeStaticPath(root: string, requested: string): string {
  const decoded = decodeURIComponent(requested.split('?')[0] ?? '/').replaceAll('\\', '/');
  if (decoded.split('/').includes('..')) throw new Error('invalid static path');
  const clean = normalize(decoded).replace(/^[/\\]+/u, '');
  const path = resolve(root, clean || 'index.html');
  const base = resolve(root);
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error('invalid static path');
  return path;
}

export function createUiServer(workspace: string, token: string): Server {
  const staticRoot = assetPath('dist', 'ui');
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (await handleApiRequest(workspace, request, response, url, token)) return;
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const path = safeStaticPath(staticRoot, requested);
      if (!existsSync(path)) { json(response, 404, { error: 'not found' }); return; }
      response.writeHead(200, {
        'content-type': types[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });
      createReadStream(path).pipe(response);
    } catch (error) {
      json(response, error instanceof Error && error.message === 'invalid static path' ? 400 : errorStatus(error), {
        error: error instanceof Error ? error.message : String(error),
      });
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
