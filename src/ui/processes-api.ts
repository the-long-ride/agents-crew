import { changeRunStatus, resumeRun } from '../orchestration/run-control.js';
import { ProcessRegistry, type ManagedProcessRecord } from '../runtime/process-registry.js';
import type { Run } from '../domain/types.js';
import type { ApiRouteResult } from './connections-api.js';

function requireState(record: ManagedProcessRecord, allowed: ManagedProcessRecord['state'][], action: string): void {
  if (!allowed.includes(record.state)) throw new Error(`cannot ${action} process in ${record.state} state`);
}

export async function processApiRequest(workspace: string, method: string | undefined, pathname: string): Promise<ApiRouteResult> {
  const registry = new ProcessRegistry(workspace);
  if (method === 'GET' && pathname === '/api/processes') {
    await registry.prune();
    return { matched: true, value: { processes: await registry.list() } };
  }
  const match = pathname.match(/^\/api\/processes\/([^/]+)\/(pause|resume|restart|stop)$/u);
  if (!match) return { matched: false };
  if (method !== 'POST') throw new Error('method not allowed');
  const id = decodeURIComponent(match[1] as string);
  const action = match[2] as 'pause' | 'resume' | 'restart' | 'stop';
  const record = await registry.get(id);
  if (!record) throw new Error(`process not found: ${id}`);
  let run: Run | undefined;
  if (action === 'pause') {
    requireState(record, ['running'], action);
    run = await changeRunStatus(workspace, record.run_id, 'paused', 'ui');
    return { matched: true, value: { process: await registry.update(id, { state: 'pausing' }), run } };
  }
  if (action === 'resume') {
    requireState(record, ['paused'], action);
    const completed = await registry.complete(id, 'exited', record.exit_code, 'resumed as a new managed worker process');
    run = await resumeRun(workspace, record.run_id);
    return { matched: true, value: { process: completed, run } };
  }
  if (action === 'restart') {
    requireState(record, ['running'], action);
    return { matched: true, value: { process: await registry.requestControl(id, 'restart') } };
  }
  requireState(record, ['running', 'pausing', 'paused'], action);
  run = await changeRunStatus(workspace, record.run_id, 'cancelled', 'ui');
  if (record.state === 'paused') {
    return { matched: true, value: { process: await registry.complete(id, 'exited', record.exit_code, 'stopped while safely paused'), run } };
  }
  return { matched: true, value: { process: await registry.requestControl(id, 'stop'), run } };
}
