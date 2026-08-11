import { GlobalHostConnections } from '../plugins/global-connections.js';

export interface ApiRouteResult { matched: boolean; value?: unknown }

export async function connectionApiRequest(home: string, method: string | undefined, pathname: string): Promise<ApiRouteResult> {
  const service = new GlobalHostConnections(home);
  if (method === 'GET' && pathname === '/api/connections') {
    return { matched: true, value: { connections: await service.list() } };
  }
  const match = pathname.match(/^\/api\/connections\/([^/]+)\/(connect|check|repair|disconnect)$/u);
  if (!match) return { matched: false };
  if (method !== 'POST') throw new Error('method not allowed');
  const host = decodeURIComponent(match[1] as string);
  const action = match[2] as 'connect' | 'check' | 'repair' | 'disconnect';
  const value = action === 'connect' ? await service.connect(host)
    : action === 'check' ? await service.check(host)
      : action === 'repair' ? await service.repair(host)
        : await service.disconnect(host);
  return { matched: true, value };
}
