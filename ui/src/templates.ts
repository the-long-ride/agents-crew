import { byId, escapeHtml } from './dom.js';
import type { AppState, TemplateRecord } from './types.js';

export interface TemplateActions {
  open(record: TemplateRecord): void;
  delete(record: TemplateRecord): void;
}

function row(record: TemplateRecord): string {
  const key = `${escapeHtml(record.scope)}:${escapeHtml(record.id)}`;
  const deleteButton = record.scope === 'builtin'
    ? ''
    : `<button type="button" class="danger-button" data-delete="${key}">Delete</button>`;
  return `<tr>
    <td><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.description || 'No description')}</small></td>
    <td><code>${escapeHtml(record.id)}</code></td>
    <td><span class="scope-label scope-${escapeHtml(record.scope)}">${escapeHtml(record.scope)}</span></td>
    <td>${record.config.workers.length}</td>
    <td><small>${escapeHtml(record.path || (record.scope === 'builtin' ? 'Bundled with Agents Crew' : 'Managed template'))}</small></td>
    <td><div class="table-actions"><button type="button" class="secondary-button" data-open="${key}">Open builder</button>${deleteButton}</div></td>
  </tr>`;
}

export function templateTableMarkup(records: TemplateRecord[]): string {
  return records.length ? `<table class="data-table">
    <thead><tr><th>Name</th><th>ID</th><th>Scope</th><th>Workers</th><th>Source</th><th>Actions</th></tr></thead>
    <tbody>${records.map(row).join('')}</tbody>
  </table>` : '<div class="empty">No templates found.</div>';
}

export function renderTemplates(state: AppState, actions: TemplateActions): void {
  const root = byId<HTMLDivElement>('template-table');
  root.innerHTML = templateTableMarkup(state.templates);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      const record = state.templates.find((item) => `${item.scope}:${item.id}` === button.dataset.open);
      if (record) actions.open(record);
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
    button.addEventListener('click', () => {
      const record = state.templates.find((item) => `${item.scope}:${item.id}` === button.dataset.delete);
      if (record) actions.delete(record);
    });
  }
}
