interface ErrorPayload { error?: string }

let apiToken = typeof window === 'undefined'
  ? ''
  : new URLSearchParams(window.location.search).get('token') ?? '';

export function setApiToken(token: string): void { apiToken = token; }

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/api/')) throw new Error('Agents Crew UI only permits same-origin /api/ requests');
  const headers = new Headers(options.headers);
  headers.set('x-agents-crew-token', apiToken);
  if (options.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  let payload: T & ErrorPayload;
  try { payload = await response.json() as T & ErrorPayload; }
  catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
