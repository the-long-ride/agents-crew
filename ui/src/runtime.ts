import { byId, escapeHtml } from './dom.js';
import type { RunDetail, RunSummary } from './types.js';

export interface RuntimeActions {
  loadRun(id: string, history: boolean): Promise<void>;
  controlRun(action: 'pause' | 'resume' | 'cancel'): Promise<void>;
}

export interface RunViewConfig {
  listId: string;
  detailId: string;
  runs: RunSummary[];
  selectedId: string | null;
  detail: RunDetail | null;
  history: boolean;
  actions: RuntimeActions;
}

function controls(detail: RunDetail): string {
  const terminal = ['completed', 'cancelled', 'failed', 'blocked'].includes(detail.run.status);
  return `<div class="controls">
    <button type="button" class="secondary-button" data-control="resume"${terminal ? ' disabled' : ''}>Resume</button>
    <button type="button" class="secondary-button" data-control="pause"${terminal || detail.run.status === 'paused' ? ' disabled' : ''}>Pause</button>
    <button type="button" class="danger-button" data-control="cancel"${terminal ? ' disabled' : ''}>Cancel</button>
  </div>`;
}

function runRows(runs: RunSummary[], selectedId: string | null): string {
  if (!runs.length) return '<div class="empty">No runs in this view.</div>';
  return runs.map((run) => `<button type="button" class="run-row${selectedId === run.id ? ' selected' : ''}" data-run="${escapeHtml(run.id)}">
    <span class="status-dot ${escapeHtml(run.status)}"></span>
    <span><strong>${escapeHtml(run.goal)}</strong><small>${escapeHtml(run.status)} · ${run.completed_tasks}/${run.total_tasks} tasks</small></span>
    <code>${escapeHtml(run.id.slice(0, 8))}</code>
  </button>`).join('');
}

function detailMarkup(detail: RunDetail, history: boolean): string {
  const tasks = Object.values(detail.run.tasks);
  return `<p class="eyebrow">${history ? 'Archived run' : 'Active run'}</p>
    <h3>${escapeHtml(detail.run.original_goal)}</h3>
    <div class="metrics">
      <span>${escapeHtml(detail.run.status)}</span>
      <span>${detail.run.iteration}/${detail.run.max_iterations} iterations</span>
      <span>${tasks.length} tasks</span>
      <span>${detail.pending_actions.length} pending actions</span>
    </div>
    ${history ? '<p class="field-note">Archived runs are read-only.</p>' : controls(detail)}
    <h4>Current status</h4><p>${escapeHtml(detail.run.terminal_summary || 'Run is progressing through durable task state.')}</p>
    <h4>Tasks</h4><div class="task-list">${tasks.length ? tasks.map((task) => `<div class="task-row"><span class="badge">${escapeHtml(task.status)}</span><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.id)} · ${escapeHtml(task.role)}</small></span><code>${escapeHtml(task.assigned_member || 'unassigned')}</code></div>`).join('') : '<p>None</p>'}</div>
    <h4>Events</h4><div class="event-list">${detail.events.length ? [...detail.events].reverse().map((event) => `<div><code>#${event.sequence}</code><span>${escapeHtml(event.kind)}</span><small>${escapeHtml(new Date(event.timestamp).toLocaleString())}</small></div>`).join('') : '<p>None</p>'}</div>
    <h4>Durable files</h4><div class="file-list">${detail.files.length ? detail.files.map((file) => `<code>${escapeHtml(file)}</code>`).join('') : '<span>None</span>'}</div>`;
}

export function renderRunView(config: RunViewConfig): void {
  const list = byId<HTMLDivElement>(config.listId);
  const detail = byId<HTMLElement>(config.detailId);
  list.innerHTML = runRows(config.runs, config.selectedId);
  for (const button of list.querySelectorAll<HTMLButtonElement>('[data-run]')) {
    button.addEventListener('click', () => void config.actions.loadRun(button.dataset.run as string, config.history));
  }
  if (!config.detail) {
    detail.innerHTML = `<div class="empty">Select ${config.history ? 'an archived' : 'an active'} run.</div>`;
    return;
  }
  detail.innerHTML = detailMarkup(config.detail, config.history);
  if (config.history) return;
  for (const button of detail.querySelectorAll<HTMLButtonElement>('[data-control]')) {
    button.addEventListener('click', () => void config.actions.controlRun(button.dataset.control as 'pause' | 'resume' | 'cancel'));
  }
}
