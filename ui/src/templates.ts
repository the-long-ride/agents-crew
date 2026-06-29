import { byId, escapeHtml } from './dom.js';
import type { AppState, TemplateRecord } from './types.js';

function row(record: TemplateRecord): string {
  return `<tr>
    <td><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.description || 'No description')}</small></td>
    <td><code>${escapeHtml(record.id)}</code></td>
    <td><span class="scope-label scope-${escapeHtml(record.scope)}">${escapeHtml(record.scope)}</span></td>
    <td>${record.config.workers.length}</td>
    <td><small>${escapeHtml(record.path || (record.scope === 'builtin' ? 'Bundled with Agents Crew' : 'Managed template'))}</small></td>
    <td><button type="button" class="secondary-button" data-open="${escapeHtml(record.scope)}:${escapeHtml(record.id)}">Open builder</button></td>
  </tr>`;
}

export function renderTemplates(state: AppState, open: (record: TemplateRecord) => void): void {
  const root = byId<HTMLDivElement>('template-table');
  root.innerHTML = state.templates.length ? `<table class="data-table">
    <thead><tr><th>Name</th><th>ID</th><th>Scope</th><th>Workers</th><th>Source</th><th>Action</th></tr></thead>
    <tbody>${state.templates.map(row).join('')}</tbody>
  </table>` : '<div class="empty">No templates found.</div>';
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      const record = state.templates.find((item) => `${item.scope}:${item.id}` === button.dataset.open);
      if (record) open(record);
    });
  }
}
