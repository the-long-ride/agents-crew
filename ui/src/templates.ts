import { byId, escapeHtml } from './dom.js';
import type { AppState, CrewRecord } from './types.js';

export interface CrewActions {
  open(record: CrewRecord): void;
  delete(record: CrewRecord): void;
}

function row(record: CrewRecord): string {
  const key = `${escapeHtml(record.scope)}:${escapeHtml(record.id)}`;
  const deleteButton = record.scope === 'builtin'
    ? ''
    : `<button type="button" class="danger-button" data-delete="${key}" data-tooltip="Delete ${escapeHtml(record.name)}" data-tooltip-position="top">Delete</button>`;
  return `<tr>
    <td><strong>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.description || 'No description')}</small></td>
    <td><code>${escapeHtml(record.id)}</code></td>
    <td><span class="scope-label scope-${escapeHtml(record.scope)}">${escapeHtml(record.scope)}</span></td>
    <td>${record.config.workers.length}</td>
    <td><small>${escapeHtml(record.path || (record.scope === 'builtin' ? 'Bundled with Agents Crew' : 'Managed crew'))}</small></td>
    <td><div class="table-actions"><button type="button" class="secondary-button" data-open="${key}" data-tooltip="Open crew in builder" data-tooltip-position="top">Open builder</button>${deleteButton}</div></td>
  </tr>`;
}

export function crewTableMarkup(records: CrewRecord[]): string {
  return records.length ? `<table class="data-table">
    <thead><tr><th>Name</th><th>ID</th><th>Scope</th><th>Members</th><th>Source</th><th>Actions</th></tr></thead>
    <tbody>${records.map(row).join('')}</tbody>
  </table>` : '<div class="empty">No crews found.</div>';
}

function wireButtons(root: HTMLDivElement, state: AppState, actions: CrewActions): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === button.dataset.open);
      if (record) actions.open(record);
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
    button.addEventListener('click', () => {
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === button.dataset.delete);
      if (record) actions.delete(record);
    });
  }
}

let crewsSetup = false;

export function renderAllCrews(state: AppState, actions: CrewActions): void {
  const root = byId<HTMLDivElement>('crew-table');
  const searchEl = byId<HTMLInputElement>('crew-table-search');
  const filterEl = byId<HTMLSelectElement>('crew-table-filter');

  if (!crewsSetup) {
    crewsSetup = true;
    searchEl.addEventListener('input', () => renderAllCrews(state, actions));
    filterEl.addEventListener('change', () => renderAllCrews(state, actions));
  }

  const query = searchEl.value.trim().toLowerCase();

  const groupSet = new Set<string>();
  for (const c of state.crews) {
    const g = c.config.template?.group || c.group;
    if (g) groupSet.add(g);
  }
  const sortedGroupNames = [...groupSet].sort();
  const selectedFilter = filterEl.value;
  filterEl.innerHTML = '<option value="">All groups</option>'
    + sortedGroupNames.map((g) => `<option value="${escapeHtml(g)}"${g === selectedFilter ? ' selected' : ''}>${escapeHtml(g)}</option>`).join('');

  let records = state.crews;
  if (query) {
    records = records.filter((c) =>
      `${c.id} ${c.name} ${c.description || ''} ${c.config.template?.group || c.group || ''}`
        .toLowerCase().includes(query));
  }
  if (selectedFilter) {
    records = records.filter((c) => (c.config.template?.group || c.group) === selectedFilter);
  }

  const groupMap = new Map<string, CrewRecord[]>();
  for (const r of records) {
    const g = r.config.template?.group || r.group || 'Ungrouped';
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(r);
  }

  const sortedGroups = [...groupMap.keys()].sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  byId('crew-table-count').textContent = `${records.length} crew${records.length !== 1 ? 's' : ''} in ${groupMap.size} group${groupMap.size !== 1 ? 's' : ''}`;

  let html = '';
  for (const groupName of sortedGroups) {
    const items = groupMap.get(groupName)!;
    items.sort((a, b) => a.name.localeCompare(b.name));
    html += `<div class="crew-table-group">
      <h3 class="table-group-heading">${escapeHtml(groupName)} <small>(${items.length})</small></h3>
      <table class="data-table">
        <thead><tr><th>Name</th><th>ID</th><th>Scope</th><th>Members</th><th>Source</th><th>Actions</th></tr></thead>
        <tbody>${items.map((r) => row(r)).join('')}</tbody>
      </table>
    </div>`;
  }

  if (!html) html = '<div class="empty">No crews match.</div>';
  root.innerHTML = html;
  wireButtons(root, state, actions);
}