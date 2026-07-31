import { escapeHtml } from '../dom.js';
import type { AppState, CrewRecord } from '../types.js';
import type { BuilderActions } from '../builder.js';

export function renderRow(item: CrewRecord, state: AppState): string {
  const isSelected = state.current?.id === item.id && state.current.scope === item.scope;
  const canDelete = Boolean(item.path && item.scope !== 'builtin');
  const key = `${escapeHtml(item.scope)}:${escapeHtml(item.id)}`;
  return `<div class="list-row${isSelected ? ' selected' : ''}" data-crew="${key}" draggable="true">` +
    `<button type="button" class="list-row-select" data-select-crew="${key}">` +
      `<span class="list-row-name">${escapeHtml(item.name)}</span>` +
      `<small>${escapeHtml(item.scope)}</small>` +
    `</button>` +
    (canDelete
      ? `<button type="button" class="list-row-delete" data-delete-crew="${key}" aria-label="Delete crew ${escapeHtml(item.name)}" title="Delete crew">` +
          `<svg class="button-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` +
        `</button>`
      : '') +
  `</div>`;
}

export function renderCrewList(
  state: AppState,
  list: HTMLDivElement,
  actions: BuilderActions,
  renderMetadata: () => void,
): void {
  const query = state.search.trim().toLowerCase();
  const filtered = query
    ? state.crews.filter((item) => `${item.id} ${item.name} ${item.config.template?.group || item.group || ''}`.toLowerCase().includes(query))
    : state.crews;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty">No matching crews.</div>';
    return;
  }

  const definedGroups = new Set<string>(state.groups || []);
  for (const item of state.crews) {
    const g = item.config.template?.group || item.group;
    if (g) definedGroups.add(g);
  }

  if (state.current) {
    const activeGroup = state.current.config.template?.group || state.current.group;
    const targetGroup = activeGroup || '__ungrouped__';
    if (state.collapsedGroups?.includes(targetGroup)) {
      state.collapsedGroups = state.collapsedGroups.filter((g) => g !== targetGroup);
    }
  }

  const groupMap = new Map<string, CrewRecord[]>();
  for (const g of definedGroups) {
    groupMap.set(g, []);
  }

  const ungrouped: CrewRecord[] = [];
  for (const item of filtered) {
    const g = item.config.template?.group || item.group;
    if (g && groupMap.has(g)) {
      groupMap.get(g)!.push(item);
    } else if (g) {
      groupMap.set(g, [item]);
    } else {
      ungrouped.push(item);
    }
  }

  let html = '';
  for (const [groupName, items] of groupMap.entries()) {
    const isCollapsed = (state.collapsedGroups || []).includes(groupName);
    const isGroupEmpty = items.length === 0;
    html += `<div class="group-section" data-drop-group="${escapeHtml(groupName)}">` +
      `<div class="group-header">` +
      `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="${escapeHtml(groupName)}" aria-expanded="${!isCollapsed}">` +
        `<span class="group-header-title">` +
          `<svg class="group-chevron" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5"></path></svg>` +
          `<span>${escapeHtml(groupName)}</span>` +
        `</span>` +
      `</button>` +
        `<div class="group-header-right">` +
          `<small>(${items.length})</small>` +
          (isGroupEmpty ? `<button type="button" class="group-delete-button" data-delete-group="${escapeHtml(groupName)}" aria-label="Delete empty group ${escapeHtml(groupName)}" title="Delete group">` +
            `<svg class="button-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 7v4.5M9.5 7v4.5M4 4.5l.7 8.4a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` +
          `</button>` : '') +
        `</div>` +
      `</div>` +
      `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
        (items.length
          ? items.map((item) => renderRow(item, state)).join('')
          : '<div class="group-empty">No crews in this group.</div>') +
      `</div>` +
    `</div>`;
  }

  if (ungrouped.length || definedGroups.size > 0) {
    if (definedGroups.size > 0) {
      const isCollapsed = (state.collapsedGroups || []).includes('__ungrouped__');
      html += `<div class="group-section" data-drop-group="__ungrouped__">` +
        `<div class="group-header">` +
        `<button type="button" class="group-header-toggle${isCollapsed ? ' collapsed' : ''}" data-group-toggle="__ungrouped__" aria-expanded="${!isCollapsed}">` +
          `<span class="group-header-title">` +
            `<svg class="group-chevron" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5"></path></svg>` +
            `<span>Ungrouped</span>` +
          `</span>` +
          `<small>(${ungrouped.length})</small>` +
        `</button>` +
        `</div>` +
        `<div class="group-items${isCollapsed ? ' collapsed' : ''}">` +
          ungrouped.map((item) => renderRow(item, state)).join('') +
        `</div>` +
      `</div>`;
    } else {
      html += `<div class="group-items">${ungrouped.map((item) => renderRow(item, state)).join('')}</div>`;
    }
  }

  list.innerHTML = html;

  for (const toggleBtn of list.querySelectorAll<HTMLButtonElement>('[data-group-toggle]')) {
    toggleBtn.addEventListener('click', () => {
      const gName = toggleBtn.dataset.groupToggle!;
      state.collapsedGroups = state.collapsedGroups || [];
      if (state.collapsedGroups.includes(gName)) {
        state.collapsedGroups = state.collapsedGroups.filter((g) => g !== gName);
      } else {
        state.collapsedGroups.push(gName);
      }
      renderCrewList(state, list, actions, renderMetadata);
    });
  }

  for (const deleteGroupBtn of list.querySelectorAll<HTMLButtonElement>('[data-delete-group]')) {
    deleteGroupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gName = deleteGroupBtn.dataset.deleteGroup!;
      actions.deleteGroup?.(gName);
    });
  }

  for (const titleEl of list.querySelectorAll<HTMLElement>('.group-header-title span:last-child')) {
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const header = titleEl.closest('.group-header') as HTMLElement;
      const toggleBtn = header?.querySelector<HTMLButtonElement>('[data-group-toggle]');
      const groupName = toggleBtn?.dataset.groupToggle;
      if (!groupName || groupName === '__ungrouped__') return;
      const oldName = groupName;
      const currentText = titleEl.textContent ?? '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.className = 'input group-rename-input';
      input.style.cssText = 'font: 600 11px/1.2 var(--mono); padding: 2px 4px; width: 120px;';
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        const val = input.value.trim();
        input.replaceWith(titleEl);
        if (val && val !== oldName) {
          void actions.renameGroup?.(oldName, val);
        }
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
        else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(titleEl); }
      });
    });
  }

  for (const selectBtn of list.querySelectorAll<HTMLButtonElement>('[data-select-crew]')) {
    selectBtn.addEventListener('click', () => {
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === selectBtn.dataset.selectCrew);
      if (record) actions.selectCrew(record);
    });
  }

  for (const deleteBtn of list.querySelectorAll<HTMLButtonElement>('[data-delete-crew]')) {
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === deleteBtn.dataset.deleteCrew);
      if (record) actions.deleteCrew(record);
    });
  }

  for (const nameEl of list.querySelectorAll<HTMLElement>('.list-row-name')) {
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const row = nameEl.closest('.list-row') as HTMLElement;
      if (!row) return;
      const key = row.dataset.crew;
      const record = state.crews.find((item) => `${item.scope}:${item.id}` === key);
      if (!record || record.scope === 'builtin' || !record.path) return;
      const currentText = nameEl.textContent ?? '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.className = 'input list-row-rename-input';
      input.style.cssText = 'width: 100%; padding: 2px 4px; font-weight: 500;';
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        const val = input.value.trim();
        input.replaceWith(nameEl);
        if (val && val !== currentText) {
          void actions.renameCrew?.(record, val);
        }
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') { ke.preventDefault(); finish(); }
        else if (ke.key === 'Escape') { ke.preventDefault(); done = true; input.replaceWith(nameEl); }
      });
    });
  }

  let draggedCrewKey: string | null = null;

  for (const row of list.querySelectorAll<HTMLElement>('.list-row[draggable="true"]')) {
    row.addEventListener('dragstart', (e) => {
      const key = row.dataset.crew!;
      draggedCrewKey = key;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'move';
      }
      row.classList.add('dragging');
    });

    row.addEventListener('dragend', () => {
      draggedCrewKey = null;
      row.classList.remove('dragging');
      for (const section of list.querySelectorAll<HTMLElement>('[data-drop-group]')) {
        section.classList.remove('drag-over');
      }
    });
  }

  for (const section of list.querySelectorAll<HTMLElement>('[data-drop-group]')) {
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      section.classList.add('drag-over');
    });

    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget as Node)) {
        section.classList.remove('drag-over');
      }
    });

    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.classList.remove('drag-over');
      const key = e.dataTransfer?.getData('text/plain') || draggedCrewKey;
      if (!key) return;

      const record = state.crews.find((item) => `${item.scope}:${item.id}` === key);
      if (!record) return;

      const rawGroup = section.dataset.dropGroup!;
      const targetGroup = rawGroup === '__ungrouped__' ? undefined : rawGroup;

      const currentGroup = record.config.template?.group || record.group;
      if (currentGroup === targetGroup) return;

      void (async () => {
        if (actions.moveCrewGroup && !(await actions.moveCrewGroup(record, targetGroup))) return;
        record.group = targetGroup;
        record.config.template.group = targetGroup;
        if (state.current && `${state.current.scope}:${state.current.id}` === key) {
          state.current.group = targetGroup;
          state.current.config.template.group = targetGroup;
          renderMetadata();
        }
        const collapseKey = targetGroup || '__ungrouped__';
        if (state.collapsedGroups?.includes(collapseKey)) {
          state.collapsedGroups = state.collapsedGroups.filter((g) => g !== collapseKey);
        }
        renderCrewList(state, list, actions, renderMetadata);
      })();
    });
  }
}