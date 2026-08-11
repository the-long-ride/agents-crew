import { byId, escapeHtml } from './dom.js';
import type { ManagedProcess } from './types.js';

export type ProcessAction = 'pause' | 'resume' | 'restart' | 'stop';
export interface ProcessActions { control(id: string, action: ProcessAction): Promise<void> }

function uptime(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function processControls(process: ManagedProcess): string {
  const allowed: ProcessAction[] = process.state === 'running' ? ['pause', 'restart', 'stop']
    : process.state === 'pausing' ? ['stop']
      : process.state === 'paused' ? ['resume', 'stop'] : [];
  if (!allowed.length) return '<span class="process-finished">—</span>';
  return allowed.map((action) => `<button type="button" class="${action === 'stop' ? 'danger-button' : 'secondary-button'}" data-process-action="${action}" aria-label="${action} process ${escapeHtml(process.worker_id)}">${action[0]?.toUpperCase()}${action.slice(1)}</button>`).join('');
}

export function processTableMarkup(processes: ManagedProcess[], now = Date.now()): string {
  if (!processes.length) return '<div class="empty process-empty">No Agents-Crew-managed processes are active.</div>';
  return `<div class="table-shell process-shell"><table class="data-table process-table">
    <thead><tr><th>Worker</th><th>Run / Task</th><th>PID</th><th>State</th><th>Uptime</th><th>Controls</th></tr></thead>
    <tbody>${processes.map((process) => `<tr data-process="${escapeHtml(process.id)}">
      <td data-label="Worker"><strong>${escapeHtml(process.worker_id)}</strong><small>${escapeHtml(process.host)}</small></td>
      <td data-label="Run / Task"><code>${escapeHtml(process.run_id.slice(0, 8))}</code><small>${escapeHtml(process.task_id)}</small></td>
      <td data-label="PID"><code>${process.pid}</code></td>
      <td data-label="State"><span class="process-state ${escapeHtml(process.state)}">${escapeHtml(process.state)}</span>${process.message ? `<small>${escapeHtml(process.message)}</small>` : ''}</td>
      <td data-label="Uptime">${escapeHtml(uptime(process.started_at, now))}</td>
      <td data-label="Controls"><div class="table-actions">${processControls(process)}</div></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function renderProcessTable(containerId: string, processes: ManagedProcess[], actions: ProcessActions): void {
  const container = byId<HTMLDivElement>(containerId);
  container.innerHTML = processTableMarkup(processes);
  for (const row of container.querySelectorAll<HTMLElement>('[data-process]')) {
    const id = row.dataset.process as string;
    for (const button of row.querySelectorAll<HTMLButtonElement>('[data-process-action]')) {
      button.addEventListener('click', () => void actions.control(id, button.dataset.processAction as ProcessAction));
    }
  }
}
